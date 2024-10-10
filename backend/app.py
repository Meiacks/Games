# backend/app.py

import eventlet
eventlet.monkey_patch()

import os, json, uuid, logging, threading
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import emit, SocketIO, join_room, leave_room

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
rooms = {}        # room_id: [player1_sid, player2_sid]
player_moves = {} # room_id: {sid: move}

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
    emit("leaderboard_updated", {"leaderboard": leaderboard}, room=request.sid)
    logger.info(f"Sent leaderboard to {request.sid}")

@socketio.on("find_match")
def handle_find_match():
    logger.info(f"Client {request.sid} is looking for a match.")
    for room_id, players in rooms.items():
        if len(players) == 1:
            players.append(request.sid)
            join_room(room_id)
            emit("match_found", {"room": room_id}, room=room_id)
            logger.info(f"Match found in room {room_id} for players {players}")
            return
    # Create new room
    room_id = str(uuid.uuid4())
    rooms[room_id] = [request.sid]
    player_moves[room_id] = {}
    join_room(room_id)
    emit("waiting", {"room": room_id}, room=request.sid)
    logger.info(f"Created room {room_id} for player {request.sid}")

@socketio.on("make_move")
def handle_make_move(data):
    room_id = data.get("room")
    move = data.get("move")
    logger.info(f"Player {request.sid} in room {room_id} made move: {move}")

    if room_id in rooms:
        player_moves[room_id][request.sid] = move
        emit("move_received", {"player": request.sid, "move": move}, room=room_id, include_self=False)
        logger.info(f"Moves in room {room_id}: {player_moves[room_id]}")
        if len(player_moves[room_id]) == 2:
            player1, player2 = rooms[room_id]
            move1 = player_moves[room_id][player1]
            move2 = player_moves[room_id][player2]
            result1, result2 = determine_result(move1, move2)

            emit("game_result", {"your_move": move1, "opponent_move": move2, "result": result1}, room=player1)
            emit("game_result", {"your_move": move2, "opponent_move": move1, "result": result2}, room=player2)

            player_moves[room_id] = {}
    else:
        emit("error", {"message": "Invalid room ID"}, room=request.sid)
        logger.warning(f"Invalid room {room_id} by {request.sid}")

@socketio.on("cancel_find_match")
def handle_cancel_find_match(data):
    room_id = data.get('room')
    player_id = data.get('playerId')

    if room_id in rooms and player_id in rooms[room_id]:
        rooms[room_id].remove(player_id)
        leave_room(room_id)
        logger.info(f"Player {player_id} left room {room_id}")
        
        if len(rooms[room_id]) == 0:
            del rooms[room_id]
            del player_moves[room_id]
            logger.info(f"Deleted empty room {room_id}")

@socketio.on("disconnect")
def handle_disconnect():
    logger.info(f"Client disconnected: {request.sid}")
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
                emit("opponent_left", room=room_id)
                del player_moves[room_id]
                logger.info(f"Room {room_id} has remaining players: {players}")
            break

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5001, debug=app.config['DEBUG'])
