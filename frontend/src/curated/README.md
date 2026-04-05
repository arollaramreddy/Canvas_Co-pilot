# Curated Autonomous Inbox Package

This folder is intentionally isolated so the main app files stay untouched while the team is working.

Files:

- `AutonomousAgentsWorkingView.jsx`
  - light UI for the `Autonomous agents working` tab
  - focuses on state-change cards and reply-ready inbox messages
  - includes a settings panel for reply preferences

- `useAutonomousInboxFeed.js`
  - curated hook that loads LangGraph runtime state
  - triggers autonomous monitor sync
  - drafts and sends replies

- `autonomousInboxApi.js`
  - isolated API layer for runtime state, monitor sync, preferences, draft reply, and send reply

- `autonomous-agents-working.css`
  - styles for the curated autonomous tab UI

Suggested integration later:

1. Import `useAutonomousInboxFeed`
2. Import `AutonomousAgentsWorkingView`
3. Call the hook inside the `Autonomous agents working` tab
4. Pass `feed`, `preferences`, `onDraftReply`, `onSendReply`, and `onPreferenceChange`

Suggested backend pairing:

- `backend/lib/curated-autonomous-message-agent.js`
  - builds course-aware reply prompts
  - classifies whether a message needs course state
  - generates a structured inbox feed contract
