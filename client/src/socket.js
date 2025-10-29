import { io } from 'socket.io-client';
import { useEffect, useState } from 'react';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

export const socket = io(SOCKET_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

export const useSocket = () => {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [lastMessage, setLastMessage] = useState(null);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);

  // ===== NEW: Clear state =====
  const clearState = () => {
    setMessages([]);
    setUsers([]);
    setTypingUsers([]);
  };

  const connect = (username, token) => {
    socket.auth = token ? { token } : {};
    socket.connect();
    if (username) socket.emit('user_join', username);
  };

  const disconnect = () => {
    socket.disconnect();
    clearState(); // clear immediately after disconnect
  };

  const sendMessage = (message) => socket.emit('send_message', message);
  const sendPrivateMessage = (to, message) => socket.emit('private_message', { to, message });
  const setTyping = (isTyping) => socket.emit('typing', isTyping);

  useEffect(() => {
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);
    const onReceiveMessage = (m) => { setLastMessage(m); setMessages(p => [...p, m]); };
    const onPrivateMessage = (m) => { setLastMessage(m); setMessages(p => [...p, m]); };
    const onUserList = (list) => setUsers(list);

    const onUserJoined = (user) => setMessages(prev => [...prev, {
      id: Date.now(), system: true, message: `${user.username} joined the chat`, timestamp: new Date().toISOString(),
    }]);

    const onUserLeft = (user) => setMessages(prev => [...prev, {
      id: Date.now(), system: true, message: `${user.username} left the chat`, timestamp: new Date().toISOString(),
    }]);

    const onTypingUsers = (list) => setTypingUsers(list);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('receive_message', onReceiveMessage);
    socket.on('private_message', onPrivateMessage);
    socket.on('user_list', onUserList);
    socket.on('user_joined', onUserJoined);
    socket.on('user_left', onUserLeft);
    socket.on('typing_users', onTypingUsers);
    socket.on('message_delivered', d => setLastMessage(d));
    socket.on('message_read', d => setLastMessage(d));

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('receive_message', onReceiveMessage);
      socket.off('private_message', onPrivateMessage);
      socket.off('user_list', onUserList);
      socket.off('user_joined', onUserJoined);
      socket.off('user_left', onUserLeft);
      socket.off('typing_users', onTypingUsers);
    };
  }, []);

  return {
    socket,
    isConnected,
    lastMessage,
    messages,
    users,
    typingUsers,
    connect,
    disconnect,
    sendMessage,
    sendPrivateMessage,
    setTyping,
    clearState, // exported
  };
};

export default socket;
