# TiX-One: Next-Gen Concert Ticketing & Squad Matching

TiX-One is a modern concert ticketing platform featuring an AI-powered "Squad Matching" system that helps solo concert-goers find their perfect group based on musical vibes and personality.

## 🚀 Features

- **Concert Discovery**: Browse upcoming events.
- **Squad Matching Lobby**: 
  - **AI Vibe Analysis**: Uses Google Gemini to analyze user descriptions and match them with squads.
  - **Real-time Chat**: Join squad rooms and chat with other members (powered by Supabase Realtime).
  - **Cyber/Neon UI**: High-fidelity glassmorphism design with Framer Motion animations.
- **On-Chain Tickets**: (Planned/Partial) Integration with Sui blockchain for ticket assets.

## 🛠️ Setup Instructions

### 1. Prerequisites

- Node.js (v18+)
- NPM or Yarn
- A [Supabase](https://supabase.com/) project
- A [Google AI Studio](https://aistudio.google.com/) API Key (Gemini)

### 2. Environment Variables

Create a `.env.local` file in the root directory effectively copying `.env.example` if available. You need the following keys:

```bash
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_GEMINI_API_KEY=your_gemini_api_key
```

### 3. Database Setup (Supabase)

To enable Squad Matching, you need to set up the database tables and Realtime policies.

1.  Go to your Supabase Project -> **SQL Editor**.
2.  Run the contents of `scripts/squad-setup.sql`. This single comprehensive script handles everything:
    -   **Creates Tables**: `squads`, `squad_members`, `squad_messages`.
    -   **Seeds Data**: Adds dummy squads and messages so the UI isn't empty on first load.
    -   **Sets Security**: Enables Row-Level Security (RLS) policies.
    -   **Enables Realtime**: Configures database replication so chats update instantly.
3.  **Confirm Realtime**:
    -   Go to **Database** -> **Replication**.
    -   Verify that `squad_messages` and `squad_members` are listed.

### 4. Installation & Running

Install the dependencies (including `motion` for animations):

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

## 📂 Key Components

-   **`src/pages/SquadMatchingLobby.tsx`**: The main hub for finding squads. Includes the "AI Hero" section and the list of squads.
-   **`src/pages/SquadRoom.tsx`**: The visualization of a specific squad, including the member list and real-time chat.
-   **`src/styles/globals.css`**: Contains the custom Tailwind utility classes for the "Cyber/Neon" look (e.g., `.glass-card`, `.neon-pulse`).

## 🎨 Design System

The project uses **Tailwind CSS v4** styling with custom animations.
-   **Fonts**: Inter (sans) and Rajdhani (display).
-   **Theme**: Dark mode default with Purple/Pink/Emerald neon accents.
