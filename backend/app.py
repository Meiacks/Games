# backend/app.py

import os, json, uuid, logging, eventlet, threading
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, join_room, leave_room, emit
eventlet.monkey_patch()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Initialize extensions
CORS(app, resources={r"/*": {"origins": "http://57.129.44.194:3001"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Path to the JSON file
SCORES_FILE = 'scores.json'

# Lock for thread-safe file operations
file_lock = threading.Lock()

# Initialize scores.json if it doesn't exist
if not os.path.exists(SCORES_FILE):
    with open(SCORES_FILE, 'w') as f:
        json.dump([], f)
    logger.info("Created scores.json file.")

# In-memory structures
rooms = {}        # room_id: [player1_sid, player2_sid]
player_moves = {} # room_id: {sid: move}

def read_scores():
    with file_lock:
        try:
            with open(SCORES_FILE, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error reading scores.json: {e}")
            return []

def write_scores(scores):
    with file_lock:
        try:
            with open(SCORES_FILE, 'w') as f:
                json.dump(scores, f, indent=4)
            logger.info("Scores.json updated.")
        except Exception as e:
            logger.error(f"Error writing scores.json: {e}")

@app.route('/leaderboard', methods=['GET'])
def get_leaderboard():
    try:
        scores = read_scores()
        sorted_leaderboard = sorted(scores, key=lambda x: x['score'], reverse=True)
        return jsonify(sorted_leaderboard)
    except Exception as e:
        logger.error(f"Error fetching leaderboard: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/submit', methods=['POST'])
def submit_score():
    try:
        data = request.json
        name = data.get('name', 'Anonymous')
        score = data.get('score', 0)

        scores = read_scores()

        # Update or add score
        for entry in scores:
            if entry['name'] == name:
                if score > entry['score']:
                    entry['score'] = score
                    write_scores(scores)
                    logger.info(f"Updated score for {name}: {score}")
                break
        else:
            scores.append({'name': name, 'score': score})
            write_scores(scores)
            logger.info(f"Added score for {name}: {score}")

        # Emit updated leaderboard
        sorted_leaderboard = sorted(scores, key=lambda x: x['score'], reverse=True)
        socketio.emit('leaderboard_updated', {'leaderboard': sorted_leaderboard})

        return jsonify({'message': 'Score submitted successfully'}), 200
    except Exception as e:
        logger.error(f"Error in submit_score: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@socketio.on('connect')
def handle_connect():
    logger.info(f"Client connected: {request.sid}")
    try:
        scores = read_scores()
        sorted_leaderboard = sorted(scores, key=lambda x: x['score'], reverse=True)
        emit('leaderboard_updated', {'leaderboard': sorted_leaderboard}, room=request.sid)
        logger.info(f"Sent leaderboard to {request.sid}")
    except Exception as e:
        logger.error(f"Error on connect: {e}")

@socketio.on('find_match')
def handle_find_match():
    logger.info(f"Client {request.sid} is looking for a match.")
    # Find a room with one player
    for room_id, players in rooms.items():
        if len(players) == 1:
            players.append(request.sid)
            join_room(room_id)
            emit('match_found', {'room': room_id}, room=room_id)
            logger.info(f"Match found in room {room_id} for players {players}")
            return
    # Create new room
    room_id = str(uuid.uuid4())
    rooms[room_id] = [request.sid]
    player_moves[room_id] = {}
    join_room(room_id)
    emit('waiting', {'message': 'Waiting for an opponent...'}, room=request.sid)
    logger.info(f"Created room {room_id} for player {request.sid}")

@socketio.on('make_move')
def handle_make_move(data):
    try:
        room_id = data.get('room')
        move = data.get('move')
        logger.info(f"Player {request.sid} in room {room_id} made move: {move}")

        if room_id in rooms:
            player_moves[room_id][request.sid] = move
            emit('move_received', {'player': request.sid, 'move': move}, room=room_id, include_self=False)
            logger.info(f"Moves in room {room_id}: {player_moves[room_id]}")
            if len(player_moves[room_id]) == 2:
                player1, player2 = rooms[room_id]
                move1 = player_moves[room_id][player1]
                move2 = player_moves[room_id][player2]
                result1, result2 = determine_result(move1, move2)

                # Emit results
                emit('game_result', {'your_move': move1, 'opponent_move': move2, 'result': result1}, room=player1)
                emit('game_result', {'your_move': move2, 'opponent_move': move1, 'result': result2}, room=player2)

                # Clear moves
                player_moves[room_id] = {}
        else:
            emit('error', {'message': 'Invalid room ID'}, room=request.sid)
            logger.warning(f"Invalid room {room_id} by {request.sid}")
    except Exception as e:
        logger.error(f"Error in make_move: {e}")

@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f"Client disconnected: {request.sid}")
    # Remove from any room
    for room_id, players in list(rooms.items()):
        if request.sid in players:
            players.remove(request.sid)
            leave_room(room_id)
            logger.info(f"Removed {request.sid} from room {room_id}")
            if not players:
                del rooms[room_id]
                del player_moves[room_id]
                logger.info(f"Deleted empty room {room_id}")
            else:
                emit('opponent_left', {'message': 'Opponent has left the game.'}, room=room_id)
                del player_moves[room_id]
                logger.info(f"Room {room_id} has remaining players: {players}")
            break

def determine_result(move1, move2):
    rules = {'Rock': 'Scissors', 'Paper': 'Rock', 'Scissors': 'Paper'}
    if move1 == move2:
        return ('Draw!', 'Draw!')
    elif rules.get(move1) == move2:
        return ('You Win!', 'You Lose!')
    else:
        return ('You Lose!', 'You Win!')

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5001, debug=True)
