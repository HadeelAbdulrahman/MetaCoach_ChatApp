# 🤖 MetaCoach - AI RAG-powered Coaching Assistant

<div align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-18+-green?logo=node.js">
  <img alt="Express" src="https://img.shields.io/badge/Express.js-Backend-black?logo=express">
  <img alt="React" src="https://img.shields.io/badge/React-Frontend-blue?logo=react">
  <img alt="LanceDB" src="https://img.shields.io/badge/LanceDB-Vector_Store-orange">
</div>

<br/>

MetaCoach is a RAG-powered coaching assistant grounded in your own PDF knowledge base. It uses a semantic vector search across personal documents to provide insightful, context-aware advice via a sleek chat interface.

## ✨ Features

- **Retrieval-Augmented Generation (RAG):** Uses your personal PDFs as a knowledge base.
- **Embedded Vector Database:** Powered by LanceDB — no external database setup required.
- **Voice Input:** Web Speech API integration for hands-free interaction.
- **RAG Evaluation Suite:** A dedicated UI tab to test, debug, and evaluate your retrieval pipeline and cosine similarity scores.
- **Real-time Logging:** View server logs directly in the UI with color coding and filters.
- **Streaming Responses:** Get real-time response generation via Socket.io.
- **Smart Intent Detection:** Bypasses basic greetings and enforces structured coaching feedback.

## 🛠️ Tech Stack

- **Backend:** Node.js, Express, Socket.io
- **Frontend:** React, Vite
- **Vector Store:** LanceDB (`@lancedb/lancedb`)
- **LLM API:** Google Generative AI / Groq API
- **Embeddings:** `@xenova/transformers` (`all-MiniLM-L6-v2`)
- **Document Processing:** `pdf-parse`

## 🚀 Setup & Installation

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/metacoach.git
cd metacoach
```

### 2. Prepare your Knowledge Base (Important ⚠️)
> **Note:** The `server/material/` folder is where the system reads its knowledge base from. The original PDFs have been removed as they are confidential. 
> 
> **You must add your own PDF files to `server/material/` before running the system.** 
> The system will automatically ingest and chunk these files on startup.

```bash
mkdir -p server/material
# Copy your PDF documents into server/material/
```

### 3. Server Setup
```bash
cd server
npm install

# Set up your environment variables
# Create a .env file based on the provided .env.example or set the required keys:
echo "GROQ_API_KEY=your_key" > .env
# or GEMINI_API_KEY if using Google Generative AI

# Start the server
npm run dev
```

### 4. Client Setup
Open a new terminal window:
```bash
cd client
npm install
npm run dev
```

The application will be running at `http://localhost:5173` (or the port specified by Vite).

## 🔬 RAG Debugging & Evaluation

MetaCoach includes a built-in UI for testing your RAG pipeline:
- **Quick Probe:** Test individual queries and see retrieved chunks and their cosine similarity scores.
- **Last Chat Snapshot:** After sending a message, load the debug view to see exactly what was retrieved, candidate scores, and whether it passed the threshold.
- **Batch Eval Suite:** Define test queries with expected keywords to score your RAG pipeline's accuracy.

*(For detailed architectural changes and migration from Python to Node.js, please see the [REPORT.md](./REPORT.md).)*

## 📂 Project Structure

```text
metacoach/
├── client/                 # React frontend
│   ├── src/
│   │   ├── Chat.jsx        # Messaging & voice input
│   │   ├── RagEval.jsx     # Retrieval testing UI
│   │   └── Logs.jsx        # Live server logs viewer
│   └── package.json
└── server/                 # Node.js backend
    ├── material/           # ⚠️ ADD YOUR PDFS HERE
    ├── src/
    │   ├── index.js        # Server entry point
    │   ├── rag.js          # LanceDB vector store + ingestion
    │   ├── orchestrator.js # Pipeline coordinator
    │   ├── llm.js          # LLM API integration
    │   └── embeddings.js   # Local embedding models
    ├── package.json
    └── .env
```

## 🤝 Contributing
Contributions, issues, and feature requests are welcome! Feel free to check the issues page.
