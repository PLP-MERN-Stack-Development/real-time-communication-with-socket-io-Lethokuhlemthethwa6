// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from './socket';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function App() {
  const {
    connect,
    disconnect,
    sendMessage,
    messages,
    users,
    typingUsers,
    isConnected,
    setTyping,
    socket,
  } = useSocket();

  const [username, setUsername] = useState(localStorage.getItem('chat_username') || '');
  const [token, setToken] = useState(localStorage.getItem('chat_token') || '');
  const [msg, setMsg] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [file, setFile] = useState(null);
  const [messagesState, setMessagesState] = useState([]);
  const [usersState, setUsersState] = useState([]);
  const messagesRef = useRef(null);

  // Sync messages and users from socket
  useEffect(() => setMessagesState(messages), [messages]);
  useEffect(() => setUsersState(users), [users]);

  useEffect(() => disconnect, []);
  useEffect(() => { if (token && username) connect(username, token); }, [token]);

  // --- Login / Logout ---
  const handleLogin = async () => {
    if (!username.trim()) return alert('Enter a username');
    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      localStorage.setItem('chat_token', data.token);
      localStorage.setItem('chat_username', data.username);
      setToken(data.token);
      setUsername(data.username);
      connect(data.username, data.token);
    } catch (err) {
      alert('Login error: ' + err.message);
    }
  };

  const handleLogout = () => {
    disconnect();
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_username');
    setToken('');
    setUsername('');
    setMessagesState([]);
    setUsersState([]);
  };

  // --- Clear saved login ---
  const handleClearSavedLogin = () => {
    const confirmDelete = window.confirm("Are you sure you want to delete saved login details?");
    if (!confirmDelete) return;
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_username');
    alert("Saved login details cleared.");
  };

  // --- Upload file ---
  const uploadFile = async () => {
    if (!file) return null;
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: fd });
    if (!res.ok) { alert('Upload failed'); return null; }
    const data = await res.json();
    return data;
  };

  // --- Send message ---
  const handleSend = async () => {
    if (!msg.trim() && !file) return;
    let fileData = null;
    if (file) {
      fileData = await uploadFile();
      setFile(null);
    }
    const payload = { message: msg || '', isPrivate: !!selectedUser, to: selectedUser?.id || null, file: fileData };
    sendMessage(payload);
    setMsg('');
    setTyping(false);
  };

  // --- Scroll messages ---
  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messagesState]);

  // --- Delete a single message ---
  const handleDeleteMessage = (id) => {
    if (!window.confirm("Delete this message for everyone?")) return;
    socket.emit("delete_message", id);
    setMessagesState(prev => prev.filter(m => (m._id || m.id) !== id));
  };

  // --- Listen for message deletion ---
  useEffect(() => {
    const onMessageDeleted = (id) => {
      setMessagesState(prev => prev.filter(m => (m._id || m.id) !== id));
    };
    socket.on("message_deleted", onMessageDeleted);

    // Listen for full clears from backend
    socket.on("messages_cleared", () => setMessagesState([]));
    socket.on("users_cleared", () => setUsersState([]));

    return () => {
      socket.off("message_deleted", onMessageDeleted);
      socket.off("messages_cleared");
      socket.off("users_cleared");
    };
  }, [socket]);

  // --- Clear All Data permanently ---
  const handleClearAllData = async () => {
    if (!window.confirm('Are you sure you want to delete all messages and users?')) return;
    await fetch(`${API_URL}/api/messages/all`, { method: 'DELETE' });
    await fetch(`${API_URL}/api/users/all`, { method: 'DELETE' });
  };

  return (
    <div className="app whatsapp">
      <header>
        <h1>WhatsApp Clone</h1>
        <div className={`status ${isConnected ? 'online' : 'offline'}`}>
          {isConnected ? 'Online' : 'Offline'}
        </div>
      </header>

      <section className="controls">
        {!token ? (
          <>
            <input placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
            <button onClick={handleLogin}>Login</button>
          </>
        ) : (
          <div className="logged">
            <span>Hi <strong>{username}</strong></span>
            <button onClick={handleLogout}>Logout</button>
            <button onClick={handleClearAllData} style={{ marginLeft: 8, background: '#ff4d4f' }}>Clear All Data</button>
          </div>
        )}
      </section>

      <section className="chat">
        <aside className="users">
          <h3>People</h3>
          <ul>
            {usersState.map(u => (
              <li
                key={u._id || u.id || u.socketId}
                className={selectedUser?.id === (u.socketId || u.id) ? 'selected' : ''}
                onClick={() => setSelectedUser({ id: u.socketId || u.id, username: u.username })}
              >
                {u.username}
              </li>
            ))}
            <li className={!selectedUser ? 'selected' : ''} onClick={() => setSelectedUser(null)}>Public Chat</li>
          </ul>
        </aside>

        <div className="messages" ref={messagesRef}>
          {messagesState.map(m => {
            const isSelf = m.sender === username;
            return (
              <div
                key={m._id || m.id || Date.now()}
                className={`msg ${isSelf ? 'self' : ''}`}
                onClick={() => handleDeleteMessage(m._id || m.id)}
                style={{ cursor: 'pointer' }}
                title="Click to delete (for everyone)"
              >
                {m.file && m.file.mimetype?.startsWith('image') && (
                  <img src={m.file.url} alt={m.file.filename} className="chat-img" />
                )}
                <div className="text">{m.message}</div>
                <div className="meta">
                  <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' })}</span>
                  {isSelf && m.readBy?.length ? <span>✓✓</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="composer">
        <input
          type="text"
          placeholder={selectedUser ? `Message to ${selectedUser.username}` : "Type a message"}
          value={msg}
          onChange={e => { setMsg(e.target.value); setTyping(true); }}
          onBlur={() => setTyping(false)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
        />
        <input type="file" onChange={e => setFile(e.target.files[0])} />
        <button onClick={handleSend}>Send</button>
      </section>

      <footer>
        {typingUsers.length > 0 && <div>{typingUsers.join(', ')} typing...</div>}
      </footer>
    </div>
  );
}
