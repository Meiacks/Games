import React, { useState, useEffect } from 'react';
import './App.css';
import { io } from 'socket.io-client';

const SOCKET_SERVER_URL = 'http://57.129.44.194:5001';

function App() {
  const [gameState, setGameState] = useState('menu');
  const [playerChoice, setPlayerChoice] = useState(null);
  const [opponentChoice, setOpponentChoice] = useState(null);
  const [result, setResult] = useState('');
  const [leaderboard, setLeaderboard] = useState([]);
  const [name, setName] = useState('');
  const [hasSubmittedScore, setHasSubmittedScore] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState(null);

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(SOCKET_SERVER_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => console.log('Connected to backend'));
    newSocket.on('leaderboard_updated', ({ leaderboard }) => setLeaderboard(leaderboard));

    newSocket.on('match_found', ({ room }) => {
      setIsOnline(true);
      setRoomId(room);
      setGameState('game');
      console.log(`Match found in room ${room}`);
    });

    newSocket.on('waiting', ({ room }) => {
      setRoomId(room);
      setGameState('waiting');
      console.log(`Waiting for an opponent in room ${room}`);
    });

    newSocket.on('game_result', (data) => {
      setPlayerChoice(data.your_move);
      setOpponentChoice(data.opponent_move);
      setResult(data.result);
      setGameState('gameover');
      setHasSubmittedScore(false);
    });

    newSocket.on('opponent_left', resetGame);
    newSocket.on('error', resetGame);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Fetch leaderboard on initial load
  useEffect(() => {
    fetchLeaderboard();
  }, []);

  // Load name from localStorage on mount
  useEffect(() => {
    const storedName = localStorage.getItem('playerName');
    if (storedName) {
      setName(storedName);
    }
  }, []);

  const fetchLeaderboard = () => {
    fetch(`${SOCKET_SERVER_URL}/leaderboard`)
      .then((res) => res.json())
      .then((data) => setLeaderboard(data))
      .catch((err) => console.error('Error fetching leaderboard:', err));
  };

  const startGame = () => setGameState('mode_selection');

  const playAI = () => {
    setIsOnline(false);
    setGameState('game');
  };

  const playOnline = () => {
    if (socket) {
      socket.emit('find_match');
    }
  };

  const handleChoice = (choice) => {
    setPlayerChoice(choice);
    if (isOnline && socket && roomId) {
      socket.emit('make_move', { move: choice, room: roomId });
    } else {
      const aiChoices = ['Rock', 'Paper', 'Scissors'];
      const aiMove = aiChoices[Math.floor(Math.random() * 3)];
      const gameResult = determineResult(choice, aiMove);
      setOpponentChoice(aiMove);
      setResult(gameResult);
      setGameState('gameover');
    }
  };

  const determineResult = (player, opponent) => {
    if (player === opponent) return 'Draw!';
    const wins = { Rock: 'Scissors', Paper: 'Rock', Scissors: 'Paper' };
    return wins[player] === opponent ? 'You Win!' : 'You Lose!';
  };

  const submitScore = () => {
    const score = result === 'You Win!' ? 1 : result === 'You Lose!' ? -1 : 0;
    const trimmedName = name.trim() || 'noname';

    if (trimmedName !== 'noname') {
      localStorage.setItem('playerName', trimmedName);
    }

    fetch(`${SOCKET_SERVER_URL}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmedName, score }),
    })
      .then((res) => res.json())
      .then(() => setHasSubmittedScore(true))
      .catch((err) => console.error('Error submitting score:', err));
  };

  const resetGame = () => {
    if (socket) {
      socket.emit('cancel_find_match', { room: roomId, playerId: socket.id });
      console.log('Cancelled match');
    }
    setGameState('menu');
    setPlayerChoice(null);
    setOpponentChoice(null);
    setResult('');
    setHasSubmittedScore(false);
    setIsOnline(false);
  };

  const goToMainMenu = () => {
    setGameState('menu');
  };

  const playAgain = () => {
    if (isOnline && socket) {
      socket.emit('find_match');
      setGameState('waiting');
    } else {
      setGameState('game');
      setPlayerChoice(null);
      setOpponentChoice(null);
      setResult('');
    }
  };

  const handleNameChange = (e) => {
    const newName = e.target.value;
    if (/^[A-Za-z0-9]{0,20}$/.test(newName)) {
      setName(newName);
    }
  };

  return (
    <div className="app">
      <div className="menu_container">
        <div className="text_display" style={{ fontSize: '4vh' }}>{name || 'noname'}</div>
      </div>

      <div className="main_container">
        {gameState === 'menu' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <button className="button" onClick={startGame}>Rock, Paper, Scissors</button>
            {name && (
              <button className="button" 
                onClick={() => {localStorage.removeItem('playerName'); setName('');}}>
                Reset Name
              </button>
            )}
          </div>
        )}

        {gameState === 'mode_selection' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div className="text_display">Select Mode</div>
            <button className="button" onClick={playAI}>Versus AI</button>
            <button className="button" onClick={playOnline}>Versus Player</button>
            <button className="button" onClick={goToMainMenu}>Back</button>
          </div>
        )}

        {gameState === 'waiting' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div className="text_display">Waiting for an opponent...</div>
            <button className="button" onClick={resetGame}>Cancel</button>
          </div>
        )}

        {gameState === 'game' && (
          <div>
            <div className="text_display">Choose Your Move</div>
            <div className="choices" style={{ display: 'flex', justifyContent: 'center' }}>
              <button className="button" onClick={() => handleChoice('Rock')}>Rock</button>
              <button className="button" onClick={() => handleChoice('Paper')}>Paper</button>
              <button className="button" onClick={() => handleChoice('Scissors')}>Scissors</button>
            </div>
          </div>
        )}

        {gameState === 'gameover' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className="text_display">{playerChoice}/{opponentChoice} = {result}</div>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2vh' }}>
              {!hasSubmittedScore && (
                <div>
                  <input className="text_input" type="text" placeholder="Enter your name"
                    value={name} onChange={handleNameChange} />
                  <button className="button" onClick={submitScore}>Submit</button>
                </div>
              )}
              {hasSubmittedScore && <div className="text_display">Score submitted!</div>}
            </div>
            <div className="text_display">Leaderboard</div>
            <ul className="leaderboard">
              {leaderboard.map((entry, index) => (
                <li key={index}>{entry.score} | {entry.name}</li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '3vh' }}>
              <button className="button" onClick={playAgain}>Play Again</button>
              <button className="button" onClick={goToMainMenu}>Main Menu</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
