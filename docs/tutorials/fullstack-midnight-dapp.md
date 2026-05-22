## Full-Stack Midnight dApp: Contract + TypeScript API + Frontend

**Difficulty:** Advanced  
**Time:** 40 minutes  
**Bounty:** #314

---

### Overview

Build a complete full-stack dApp on Midnight: a Compact smart contract, a TypeScript API layer, and a React frontend. This tutorial ties together everything from contract deployment to API integration to UI rendering.

### Architecture

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  React   │────▶│  API     │────▶│ Midnight │
│  UI      │     │  Layer   │     │ Contract │
│          │◀────│          │◀────│          │
│ Component│     │ Express  │     │ Compact  │
│  State   │     │  Router  │     │  Logic   │
└──────────┘     └──────────┘     └──────────┘
                       │
                 ┌─────┴─────┐
                 │ PostgreSQL│
                 │ (optional)│
                 └───────────┘
```

### Step 1: Project Structure

```
midnight-fullstack-dapp/
├── contracts/
│   └── todo/
│       └── index.compact       # Smart contract
├── api/
│   ├── src/
│   │   ├── index.ts             # Express server
│   │   ├── routes/
│   │   │   └── todos.ts        # API routes
│   │   ├── services/
│   │   │   └── midnight.ts     # Midnight client
│   │   └── types/
│   │       └── index.ts        # Shared types
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   └── TodoList.tsx
│   │   └── hooks/
│   │       └── useTodos.ts
│   ├── package.json
│   └── tsconfig.json
└── README.md
```

### Step 2: Compact Contract

```javascript
// contracts/todo/index.compact

import { LEDGER, SEED } from "std";

struct TodoItem {
    id: u64;
    title: [u8; 64];
    completed: bool;
    owner: [u8; 32];
    createdAt: u64;
}

export const TodoDApp = contract(() => {
    const todos: Map<u64, TodoItem>;
    const nextId: u64;
    const userTodos: Map<[u8; 32], u64[10]>;  // user -> todo IDs
    
    export function initialize(): void {
        nextId = 1;
    }
    
    export function createTodo(title: [u8; 64]): u64 {
        const id = nextId;
        nextId = id + 1;
        
        const todo = TodoItem(id, title, false, SEED.publicKey, SEED.timestamp);
        todos.set(id, todo);
        
        // Add to user's list
        let userList = userTodos.get(SEED.publicKey) ?? [0; 10];
        for (let i = 0; i < 10; i++) {
            if (userList[i] == 0) {
                userList[i] = id;
                break;
            }
        }
        userTodos.set(SEED.publicKey, userList);
        
        emit("TodoCreated", id, SEED.publicKey);
        return id;
    }
    
    export function toggleTodo(id: u64): void {
        const todo = todos.get(id);
        require(todo !== null, "Todo not found");
        require(todo.owner == SEED.publicKey, "Not your todo");
        
        todo.completed = !todo.completed;
        todos.set(id, todo);
        
        emit("TodoToggled", id, todo.completed);
    }
    
    export function deleteTodo(id: u64): void {
        const todo = todos.get(id);
        require(todo !== null, "Todo not found");
        require(todo.owner == SEED.publicKey, "Not your todo");
        
        todos.delete(id);
        
        // Remove from user's list
        let userList = userTodos.get(SEED.publicKey) ?? [0; 10];
        for (let i = 0; i < 10; i++) {
            if (userList[i] == id) {
                userList[i] = 0;
                break;
            }
        }
        userTodos.set(SEED.publicKey, userList);
        
        emit("TodoDeleted", id);
    }
    
    export function getTodo(id: u64): TodoItem {
        const todo = todos.get(id);
        require(todo !== null, "Todo not found");
        return todo;
    }
});
```

### Step 3: TypeScript API Layer

```typescript
// api/src/services/midnight.ts

import { MidnightProvider } from '@midnight-ntwrk/midnight-provider';

export class MidnightService {
    private provider: MidnightProvider;
    private contractAddress: string;
    
    constructor(contractAddress: string) {
        this.contractAddress = contractAddress;
    }
    
    async connect(seed?: string) {
        this.provider = await MidnightProvider.create({
            network: 'testnet',
            seed,
        });
    }
    
    async createTodo(title: string): Promise<number> {
        // Pad title to 64 bytes
        const padded = title.padEnd(64, '\0');
        const result = await this.provider.call(
            this.contractAddress,
            'createTodo',
            [padded]
        );
        return result;
    }
    
    async toggleTodo(id: number): Promise<void> {
        await this.provider.call(
            this.contractAddress,
            'toggleTodo',
            [id]
        );
    }
    
    async deleteTodo(id: number): Promise<void> {
        await this.provider.call(
            this.contractAddress,
            'deleteTodo',
            [id]
        );
    }
    
    async getTodo(id: number): Promise<TodoItem | null> {
        try {
            return await this.provider.query(
                this.contractAddress,
                'getTodo',
                [id]
            );
        } catch {
            return null;
        }
    }
    
    async listenForEvents(callback: (event: any) => void) {
        return await this.provider.subscribeToEvents(
            this.contractAddress,
            callback
        );
    }
}

interface TodoItem {
    id: number;
    title: string;
    completed: boolean;
    owner: string;
    createdAt: number;
}
```

### Step 4: Express API Routes

```typescript
// api/src/routes/todos.ts

import { Router, Request, Response } from 'express';
import { MidnightService } from '../services/midnight';

const router = Router();
const midnight = new MidnightService(process.env.CONTRACT_ADDRESS!);

// GET /api/todos/:id
router.get('/todos/:id', async (req: Request, res: Response) => {
    try {
        const todo = await midnight.getTodo(parseInt(req.params.id));
        if (!todo) {
            return res.status(404).json({ error: 'Todo not found' });
        }
        res.json(todo);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/todos
router.post('/todos', async (req: Request, res: Response) => {
    try {
        const { title } = req.body;
        if (!title || title.length > 64) {
            return res.status(400).json({ error: 'Title required (max 64 chars)' });
        }
        
        const id = await midnight.createTodo(title);
        res.status(201).json({ id, title });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/todos/:id/toggle
router.put('/todos/:id/toggle', async (req: Request, res: Response) => {
    try {
        await midnight.toggleTodo(parseInt(req.params.id));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/todos/:id
router.delete('/todos/:id', async (req: Request, res: Response) => {
    try {
        await midnight.deleteTodo(parseInt(req.params.id));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
```

### Step 5: React Frontend

```typescript
// frontend/src/hooks/useTodos.ts

import { useState, useEffect, useCallback } from 'react';

interface Todo {
    id: number;
    title: string;
    completed: boolean;
}

export function useTodos() {
    const [todos, setTodos] = useState<Todo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    const API = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';
    
    const fetchTodos = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API}/todos`);
            const data = await res.json();
            setTodos(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [API]);
    
    const createTodo = async (title: string) => {
        const res = await fetch(`${API}/todos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
        });
        
        if (!res.ok) throw new Error('Failed to create');
        const todo = await res.json();
        setTodos(prev => [...prev, todo]);
        return todo;
    };
    
    const toggleTodo = async (id: number) => {
        await fetch(`${API}/todos/${id}/toggle`, { method: 'PUT' });
        setTodos(prev =>
            prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t)
        );
    };
    
    const deleteTodo = async (id: number) => {
        await fetch(`${API}/todos/${id}`, { method: 'DELETE' });
        setTodos(prev => prev.filter(t => t.id !== id));
    };
    
    return { todos, loading, error, createTodo, toggleTodo, deleteTodo, fetchTodos };
}
```

```typescript
// frontend/src/components/TodoList.tsx

import React, { useState } from 'react';
import { useTodos } from '../hooks/useTodos';

export function TodoList() {
    const { todos, loading, createTodo, toggleTodo, deleteTodo } = useTodos();
    const [newTitle, setNewTitle] = useState('');
    
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTitle.trim()) return;
        await createTodo(newTitle);
        setNewTitle('');
    };
    
    return (
        <div className="todo-app">
            <h1>📋 Midnight Todo dApp</h1>
            
            <form onSubmit={handleSubmit} className="todo-form">
                <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="What needs to be done?"
                    maxLength={64}
                />
                <button type="submit">Add Todo</button>
            </form>
            
            {loading && <p className="loading">Loading from Midnight...</p>}
            
            <ul className="todo-list">
                {todos.map(todo => (
                    <li key={todo.id} className={todo.completed ? 'completed' : ''}>
                        <input
                            type="checkbox"
                            checked={todo.completed}
                            onChange={() => toggleTodo(todo.id)}
                        />
                        <span className="title">{todo.title}</span>
                        <button
                            onClick={() => deleteTodo(todo.id)}
                            className="delete-btn"
                        >
                            ×
                        </button>
                    </li>
                ))}
            </ul>
            
            {todos.length === 0 && !loading && (
                <p className="empty">No todos yet. Create one above!</p>
            )}
            
            <div className="info">
                <p>🔒 Todos are stored on Midnight blockchain</p>
                <p>⚡ Each action submits a transaction</p>
            </div>
        </div>
    );
}
```

### Step 6: Deploy Script

```bash
#!/bin/bash
# deploy.sh — Full deployment

echo "=== Deploying Full-Stack Midnight dApp ==="

# 1. Build contract
echo -e "\n1. Building contract..."
midnight contract build contracts/todo --output build/

# 2. Deploy to testnet
echo -e "\n2. Deploying contract..."
CONTRACT_ADDR=$(midnight contract deploy todo-dapp \
    --args '{}' \
    --network testnet \
    --json | python3 -c "import json,sys; print(json.load(sys.stdin)['address'])")
echo "Contract: $CONTRACT_ADDR"

# 3. Update API config
echo -e "\n3. Configuring API..."
echo "CONTRACT_ADDRESS=$CONTRACT_ADDR" > api/.env
echo "PORT=3001" >> api/.env

# 4. Install & start API
echo -e "\n4. Starting API server..."
cd api
npm install
npm run build
npm start &
API_PID=$!
echo "API PID: $API_PID"

# 5. Start frontend
echo -e "\n5. Starting frontend..."
cd ../frontend
echo "REACT_APP_API_URL=http://localhost:3001/api" > .env
npm install
npm start

echo -e "\n✅ dApp is running!"
echo "   Frontend: http://localhost:3000"
echo "   API:      http://localhost:3001"
echo "   Contract: $CONTRACT_ADDR"
```

### Summary

- **Contract**: Compact smart contract for todo items
- **API**: Express.js with TypeScript, connects to Midnight
- **Frontend**: React with hooks, REST API integration
- **Deploy**: Single script deploys contract, starts API and frontend
- **Stack**: Compact + TypeScript + Express + React
