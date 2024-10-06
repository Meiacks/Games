import React, { useState, useEffect } from 'react';
import './App.css';
import { io } from 'socket.io-client';

const SOCKET_SERVER_URL = 'http://57.129.44.194:5001'; // Update as necessary

function App() {
  const [gameState, setGameState] = useState('menu'); // 'menu', 'mode_selection', 'waiting', 'game', 'gameover'
  const [playerChoice, setPlayerChoice] = useState(null);
  const [opponentChoice, setOpponentChoice] = useState(null);
  const [result, setResult] = useState('');
  const [leaderboard, setLeaderboard] = useState([]);
  const [name, setName] = useState('');
  const [hasSubmittedScore, setHasSubmittedScore] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState(null); // Store room ID

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(SOCKET_SERVER_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to backend');
    });

    newSocket.on('leaderboard_updated', (data) => {
      setLeaderboard(data.leaderboard);
    });

    newSocket.on('match_found', ({ room }) => {
      setIsOnline(true);
      setRoomId(room); // Store the room ID
      setGameState('game');
      console.log(`Match found in room ${room}`);
    });

    newSocket.on('waiting', () => {
      setGameState('waiting');
      console.log('Waiting for opponent...');
    });

    newSocket.on('game_result', (data) => {
      setPlayerChoice(data.your_move);
      setOpponentChoice(data.opponent_move);
      setResult(data.result);
      setGameState('gameover');
      setHasSubmittedScore(false);
    });

    newSocket.on('opponent_left', (data) => {
      alert(data.message);
      resetGame();
    });

    newSocket.on('error', (data) => {
      alert(data.message);
      resetGame();
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Fetch leaderboard on initial load
  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const fetchLeaderboard = () => {
    fetch(`${SOCKET_SERVER_URL}/leaderboard`)
      .then((res) => res.json())
      .then((data) => setLeaderboard(data))
      .catch((err) => console.error('Error fetching leaderboard:', err));
  };

  const startGame = () => {
    setGameState('mode_selection');
  };

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
      // Use the stored roomId when emitting the move
      socket.emit('make_move', { move: choice, room: roomId });
    } else {
      // Play against AI
      const aiChoices = ['Rock', 'Paper', 'Scissors'];
      const aiMove = aiChoices[Math.floor(Math.random() * 3)];
      setOpponentChoice(aiMove);
      const gameResult = determineResult(choice, aiMove);
      setResult(gameResult);
      setGameState('gameover');
    }
  };

  const determineResult = (player, opponent) => {
    if (player === opponent) return 'Draw!';
    if (
      (player === 'Rock' && opponent === 'Scissors') ||
      (player === 'Paper' && opponent === 'Rock') ||
      (player === 'Scissors' && opponent === 'Paper')
    ) {
      return 'You Win!';
    }
    return 'You Lose!';
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
      .then((data) => {
        setHasSubmittedScore(true);
      })
      .catch((err) => console.error('Error submitting score:', err));
  };

  const resetGame = () => {
    setGameState('menu');
    setPlayerChoice(null);
    setOpponentChoice(null);
    setResult('');
    setHasSubmittedScore(false);
    setIsOnline(false);
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

  // Load name from localStorage on mount
  useEffect(() => {
    const storedName = localStorage.getItem('playerName');
    if (storedName) {
      setName(storedName);
    }
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <p>Player: {name || 'noname'}</p>
      </header>

      <div className="App-content">
        {gameState === 'menu' && (
          <>
            <button onClick={startGame}>Start Game</button>
            {name && (
              <button
                onClick={() => {
                  localStorage.removeItem('playerName');
                  setName('');
                }}
              >
                Reset Name
              </button>
            )}
          </>
        )}

        {gameState === 'mode_selection' && (
          <>
            <h1>Select Mode</h1>
            <button onClick={playAI}>Versus AI</button>
            <button onClick={playOnline}>Versus Player</button>
            <button onClick={resetGame}>Back</button>
          </>
        )}

        {gameState === 'waiting' && (
          <>
            <h1>Waiting for an opponent...</h1>
            <button onClick={resetGame}>Cancel</button>
          </>
        )}

        {gameState === 'game' && (
          <>
            <h1>Choose Your Move</h1>
            <div className="choices">
              <button onClick={() => handleChoice('Rock')}>Rock</button>
              <button onClick={() => handleChoice('Paper')}>Paper</button>
              <button onClick={() => handleChoice('Scissors')}>Scissors</button>
            </div>
          </>
        )}

        {gameState === 'gameover' && (
          <>
            <h1>Game Over</h1>
            <p>You chose: {playerChoice}</p>
            <p>Opponent chose: {opponentChoice}</p>
            <p>{result}</p>
            {!hasSubmittedScore && (
              <>
                <input
                  type="text"
                  placeholder="Enter your name"
                  value={name}
                  onChange={handleNameChange}
                />
                <button onClick={submitScore}>Submit Score</button>
              </>
            )}
            {hasSubmittedScore && <p>Score submitted!</p>}
            <h2>Leaderboard</h2>
            <ul className="leaderboard">
              {leaderboard.map((entry, index) => (
                <li key={index}>
                  {entry.name}: {entry.score}
                </li>
              ))}
            </ul>
            <button onClick={playAgain}>Play Again</button>
            <button onClick={resetGame}>Main Menu</button>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
