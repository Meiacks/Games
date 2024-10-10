# backend/app.py

import eventlet
eventlet.monkey_patch()

import os, json, uuid, logging, threading
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, join_room, leave_room

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S")
logger = logging.getLogger(__name__)

app = Flask(__name__)

CORS(app, resources={r"/*": {"origins": "http://57.129.44.194:3001"}})
socketio = SocketIO(app, cors_allowed_origins="http://57.129.44.194:3001", async_mode="eventlet")

LEADERBOARD_FILE = "leaderboard.json"

file_lock = threading.Lock()
rooms = {}

def save_room_history(room_data):
    with file_lock:
        try:
            if os.path.exists("rooms_history.json"):
                with open("rooms_history.json", "r") as f:
                    history = json.load(f)
            else:
                history = []
            history.append(room_data)
            with open("rooms_history.json", "w") as f:
                json.dump(history, f, indent=4)
            logger.info("Room history updated.")
        except Exception as e:
            logger.error(f"Unable to write rooms_history.json: {e}")

def load_leaderboard():
    with file_lock:
        try:
            with open(LEADERBOARD_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Unable to read leaderboard.json: {e}")
            return []

def save_leaderboard(leaderboard):
    with file_lock:
        try:
            with open(LEADERBOARD_FILE, "w") as f:
                json.dump(leaderboard, f, indent=4)
            logger.info("leaderboard.json updated.")
        except Exception as e:
            logger.error(f"Unable to write leaderboard.json: {e}")

def sort_leaderboard(leaderboard):
    leaderboard = sorted(leaderboard.items(), key=lambda item: item[1], reverse=True)
    return [{"name": k, "score": v} for k, v in leaderboard]

def determine_result(move1, move2):
    rules = {"Rock": "Scissors", "Paper": "Rock", "Scissors": "Paper"}
    if move1 == move2:
        return ("Draw!", "Draw!")
    elif rules.get(move1) == move2:
        return ("You Win!", "You Lose!")
    else:
        return ("You Lose!", "You Win!")

@app.route("/leaderboard", methods=["GET"])
def get_leaderboard():
    leaderboard = sort_leaderboard(load_leaderboard())
    return jsonify(leaderboard), 200

@app.route("/submit", methods=["POST"])
def submit_score():
    data = request.json
    name = data.get("name", "noname")
    score = data.get("score", 0)
    leaderboard = load_leaderboard()
    if name not in leaderboard or leaderboard[name] < score:
        leaderboard[name] = score
    save_leaderboard(leaderboard)
    logger.info(f"New score for {name}: {score}")
    leaderboard = sort_leaderboard(leaderboard)
    socketio.emit("leaderboard_updated", {"leaderboard": leaderboard})
    return jsonify({"message": "Score submitted successfully"}), 200

@socketio.on("connect")
def handle_connect():
    logger.info(f"Client connected: {request.sid}")
    leaderboard = sort_leaderboard(load_leaderboard())
    socketio.emit("leaderboard_updated", {"leaderboard": leaderboard}, room=request.sid)
    logger.info(f"Sent leaderboard to {request.sid}")

@socketio.on("find_match")
def handle_find_match():
    logger.info(f"Client {request.sid} is looking for a match.")
    # Look for a waiting room
    for room_id, room_info in rooms.items():
        if room_info['status'] == 'waiting' and len(room_info['players']) == 1:
            # Found a waiting room
            room_info['players'].append(request.sid)
            room_info['status'] = 'running'
            room_info['step'][request.sid] = None  # Add the new player to 'step'
            join_room(room_id)
            socketio.emit("match_found", {"room": room_id}, room=room_id)
            logger.info(f"Match found in room {room_id} for players {room_info['players']}")
            return
    # No waiting room found, create a new one
    room_id = str(uuid.uuid4())
    rooms[room_id] = {
        'status': 'waiting',
        'players': [request.sid],
        'step': {
            request.sid: None,
            'winner': None
        }
    }
    join_room(room_id)
    socketio.emit("waiting", {"room": room_id}, room=request.sid)
    logger.info(f"Created new room {room_id} for player {request.sid}")

@socketio.on("make_move")
def handle_make_move(data):
    room_id = data.get("room")
    move = data.get("move")
    logger.info(f"Player {request.sid} in room {room_id} made move: {move}")

    if room_id in rooms:
        room = rooms[room_id]
        if request.sid in room['players']:
            room['step'][request.sid] = move
            socketio.emit("move_received", {"player": request.sid, "move": move}, room=room_id, include_self=False)
            logger.info(f"Step in room {room_id}: {room['step']}")

            # Check if both players have made their moves
            if all(room['step'][player_id] is not None for player_id in room['players']):
                player1_id, player2_id = room['players']
                move1 = room['step'][player1_id]
                move2 = room['step'][player2_id]
                result1, result2 = determine_result(move1, move2)

                # Update winner
                if result1 == 'You Win!':
                    room['step']['winner'] = player1_id
                elif result2 == 'You Win!':
                    room['step']['winner'] = player2_id
                else:
                    room['step']['winner'] = 'Draw'

                # Send game result to both players
                socketio.emit("game_result", {"your_move": move1, "opponent_move": move2, "result": result1}, room=player1_id)
                socketio.emit("game_result", {"your_move": move2, "opponent_move": move1, "result": result2}, room=player2_id)

                # Save the room to rooms_history.json and remove it from rooms
                # save_room_history(room)
                del rooms[room_id]
                logger.info(f"Game over in room {room_id}. Room data saved and removed from active rooms.")

        else:
            socketio.emit("error", {"message": "You are not in this room"}, room=request.sid)
            logger.warning(f"Player {request.sid} tried to make a move in room {room_id}, but is not a participant.")
    else:
        socketio.emit("error", {"message": "Invalid room ID"}, room=request.sid)
        logger.warning(f"Invalid room {room_id} by {request.sid}")

@socketio.on("cancel_find_match")
def handle_cancel_find_match(data):
    room_id = data.get('room')
    player_id = data.get('playerId')

    if room_id in rooms:
        room = rooms[room_id]
        if player_id in room['players']:
            room['players'].remove(player_id)
            leave_room(room_id)
            logger.info(f"Player {player_id} left room {room_id}")
            if not room['players']:
                del rooms[room_id]
                logger.info(f"Deleted empty room {room_id}")
        else:
            logger.warning(f"Player {player_id} tried to leave room {room_id}, but is not a participant.")
    else:
        logger.warning(f"Room {room_id} does not exist.")

@socketio.on("disconnect")
def handle_disconnect():
    logger.info(f"Client disconnected: {request.sid}")
    for room_id, room in list(rooms.items()):
        if request.sid in room['players']:
            room['players'].remove(request.sid)
            leave_room(room_id)
            logger.info(f"Removed {request.sid} from room {room_id}")
            if not room['players']:
                del rooms[room_id]
                logger.info(f"Deleted empty room {room_id}")
            else:
                remaining_player_id = room['players'][0]
                def delayed_remove(room_id, remaining_player_id):
                    eventlet.sleep(5)
                    if room_id in rooms:
                        del rooms[room_id]
                        logger.info(f"Deleted room {room_id} after opponent left.")
                        socketio.emit("opponent_left", room=remaining_player_id, to=remaining_player_id)
                        socketio.emit("return_to_menu", room=remaining_player_id, to=remaining_player_id)
                socketio.start_background_task(delayed_remove, room_id, remaining_player_id)
                logger.info(f"Room {room_id} will be deleted in 5 seconds")
            break

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5001, debug=app.config['DEBUG'])
