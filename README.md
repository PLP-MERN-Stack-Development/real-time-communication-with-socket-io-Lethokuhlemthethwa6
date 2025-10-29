# Socket.io Chat (Updated with persistence, uploads, read receipts, and deployment helpers)

## New features added
- MongoDB persistence for users and messages (mongoose)
- File/image upload stored on server disk (`/server/uploads`) via multer
- Message delivery acknowledgements and read receipts implemented via socket events
- Private messaging with persistence
- Modern colorful UI (Neon theme)
- Deployment helpers: Procfile & Dockerfile for Render (server) and `vercel.json` for client

## Environment
Create a `.env` in `server/` (copy from .env.example) and set:
```
PORT=5000
CLIENT_URL=http://localhost:5173
JWT_SECRET=your_jwt_secret_here
MONGODB_URI=mongodb://localhost:27017/socketio_chat_demo
```

## Local run
1. Server
```
cd server
npm install
cp .env.example .env
# edit .env -> set MONGODB_URI (or use local mongod)
npm run dev
```

2. Client
```
cd client
npm install
npm run dev
```

## Deployment hints
- **Server (Render)**: Create a new Web Service on Render, connect your GitHub repo, set the start command `node server.js` and environment variables (`MONGODB_URI`, `JWT_SECRET`, `CLIENT_URL`).
  You can also use the included `Dockerfile` if preferred.
- **Client (Vercel)**: Deploy the `client/` folder to Vercel. Set `Build Command` to `npm run build` and `Output Directory` to `dist`.
  Make sure to configure environment variables if your client needs `VITE_SOCKET_URL` (point it to your Render server URL).

## Notes
- Uploaded files are served from `/uploads` on the server. On Render, enable persistent disk or use external object storage for production.
- Read receipts and delivered counts are simple and stored as socketIds in the message document. You may want to map socketId -> userId for long-term stability.
