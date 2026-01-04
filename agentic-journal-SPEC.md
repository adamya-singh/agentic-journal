# Agentic Journal - Product Specification

## Vision

An AI-powered personal productivity system where the agent acts as **"Jarvis to your Iron Man"** - an intelligent, anticipatory assistant that helps you plan your day, track what you actually do, and derive insights from your productivity patterns.

The agent should be:
- **Intelligent & anticipatory**: Surfaces information before you ask
- **Witty but professional**: Has personality, knows when to be serious
- **Enabling, not condescending**: You're the hero making decisions
- **Proactive**: Provides insights, warnings, and opportunities at the right moment

Cedar-OS enables agent-controlled UI generation, allowing the agent to create dynamic visualizations, gamification elements, and personalized interfaces as AI capabilities improve.

---

## Core Concepts

### Journal-Centric Data Model

The **journal is the source of truth** for what happened. Tasks are a priority queue that feeds into the journal. Plans are scheduled intentions (separate from journal actuals).

```
Task Queue → Plan Entry (scheduled time) → Execute → Journal Entry (actual time) → Complete
```

| Concept | Purpose |
|---------|---------|
| **Task** | Something you intend to do (lives in queue until done) |
| **Plan Entry** | A scheduled intention - "I will do X at 3pm" |
| **Journal Entry** | A record of what actually happened - "I did X from 3-4pm" |
| **Staged Task** | A task due today but not yet scheduled to a specific time |

---

## Data Model

### Tasks

Tasks live in two priority queues:
- **have-to-do**: Obligations and responsibilities
- **want-to-do**: Desires and optional activities

Priority is determined by position (first = highest priority). Binary search insertion with pairwise comparison determines placement.

#### Task Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Unique identifier |
| `text` | string | Yes | Task description |
| `dueDate` | string (ISO date) | No | When the task is due |
| `duration` | number (minutes) | No | Estimated time to complete |
| `isDaily` | boolean | No | If true, task recurs daily and persists after completion |
| `project` | string | No | Parent project name |
| `area` | string | No | Top-level area (Work, Personal, Health, Learning) |
| `energyLevel` | 'low' \| 'medium' \| 'high' | No | Energy required |

#### Task Lifecycle

1. **Created**: Task enters queue at determined priority position
2. **Scheduled**: Task is planned for a specific time (creates Plan Entry)
3. **Staged**: Task is due today but not yet scheduled (appears in staging area)
4. **Completed**: Task is done
   - Non-daily tasks: Removed from queue, journal entry is the record
   - Daily tasks: Stay in queue, reset for next day

### Plan Entries

Plan entries represent **scheduled intentions** - what you plan to do and when.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `date` | string (ISO date) | Yes | The date |
| `hour` | string | Yes | Start time (e.g., "9am", "2pm") |
| `endHour` | string | No | End time for range entries |
| `taskId` | string | No | Reference to task (if task-linked) |
| `listType` | 'have-to-do' \| 'want-to-do' | No | Which list (if task-linked) |
| `text` | string | No | Free-form text (if not task-linked) |

### Journal Entries

Journal entries record **what actually happened** - the ground truth of your day.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `date` | string (ISO date) | Yes | The date |
| `hour` | string | Yes | Start time |
| `endHour` | string | No | End time for range entries |
| `taskId` | string | No | Reference to completed task |
| `listType` | 'have-to-do' \| 'want-to-do' | No | Which list (if task-linked) |
| `text` | string | No | Free-form text (if not task-linked) |
| `completedAt` | string (ISO timestamp) | No | When task was marked complete |

### Categories & Hierarchy (GTD-style)

```
Areas (top-level buckets)
├── Work
│   └── Projects
│       └── Tasks
├── Personal
├── Health
└── Learning
```

- **Areas**: Broad life categories (Work, Personal, Health, Learning)
- **Projects**: Specific endeavors with multiple tasks
- **Tasks**: Individual actionable items

---

## Agent Behavior

### Scheduling Intelligence

The agent should suggest **when** to do tasks based on:

1. **Historical patterns**: "You usually do deep work 9-11am"
2. **Task attributes**: Duration, energy level, deadline proximity
3. **Priority queue**: Suggest highest-priority tasks first

### Proactivity

The agent initiates conversation at:

- **Event-triggered moments**: When a scheduled task time arrives, when a task is overdue
- **Smart moments**: When user has been idle, when patterns suggest a nudge would help

### Conversational Style

- **Context-dependent verbosity**: Terse for quick task adds, thoughtful during planning sessions
- **Morning planning**: Help user schedule staged tasks and set intentions
- **End-of-day review**: Ask about unfinished tasks, capture what happened

### Handling Unfinished Plans

When a planned task isn't completed by end of day:

1. **Mark as missed**: Show in journal as "planned but not done"
2. **Stay in queue**: Task remains at same priority
3. **Agent asks**: Prompt user to reschedule or deprioritize

### Have-to-do vs Want-to-do Balance

- **Default**: Obligations (have-to-do) scheduled before desires (want-to-do)
- **Time protection**: Reserve specific hours for want-to-do (e.g., evenings)
- **Mood-based**: Agent asks each day how user wants to balance

---

## Journal Capture Methods

### 1. Real-time Capture
User tells agent: "I just finished X" or "I'm starting Y now"

### 2. End-of-day Recap
Agent prompts: "What did you do from 9am-12pm?"

### 3. Task Completion Auto-logging
When user marks a task complete, automatically create journal entry at current time

---

## Productivity Analytics

### Metrics to Track

| Metric | Description |
|--------|-------------|
| **Energy patterns** | When is the user most productive? |
| **Category breakdown** | Time spent per area/project |
| **Streaks** | Consecutive days completing daily tasks |
| **Plan vs Actual** | Comparison of what was planned vs done |
| **Competition vs Past Self** | "You completed 12 tasks this week vs 8 last week" |

### Custom Indicators

The week view supports 0-4 manual indicators per day for user-defined tracking (custom metric).

---

## Gamification & Motivation

### Elements

- **Streaks**: Visual counters for consecutive daily task completion ("Day 7 of working out! 🔥")
- **Accountability framing**: Agent reminds of commitments and consequences
- **Competition against past self**: Compare current performance to historical data

### Future Possibilities (Cedar-enabled)

As models improve, the agent can dynamically generate:
- Custom visualizations for productivity patterns
- Progress bars and achievement badges
- Psychologically-framed task presentations to boost motivation

---

## User Interface

### Week View

A 7-day calendar (Monday-Sunday) showing:
- **Staged tasks**: Unscheduled items due that day (amber)
- **Plan entries**: Scheduled intentions (teal)
- **Journal entries**: What actually happened (gray)
- **Completed tasks**: Done items (green, with strikethrough)

### Task Lists

Two priority queues displayed side-by-side:
- **Have to Do**: Obligations (amber theme)
- **Want to Do**: Desires (teal theme)

With "Today" sections showing tasks scheduled/due for current day.

### UI Improvements Needed

- **Color coding**: Distinct, consistent colors for entry types
- **Filter toggles**: Show/hide plans, completed, missed, etc.

### Task Addition

Binary search priority insertion via modal:
1. Enter task text, optional due date, optional daily flag
2. Compare against existing tasks ("Which is more important?")
3. O(log n) comparisons to find correct priority position

---

## Technical Architecture

### Current Stack

- **Frontend**: Next.js 15 + React 19 + Tailwind CSS
- **AI Chat**: Cedar-OS (state management, tool registration, chat UI)
- **Backend**: Mastra (agent orchestration, tool execution)
- **AI Model**: Claude 3.5 Haiku (via Anthropic SDK)
- **Storage**: JSON files (to be migrated to database)

### Desired Changes

- **Database**: Migrate from JSON files to proper database (SQLite or Postgres) for better querying
- **Keep Cedar**: Agent-controlled UI is core to the vision

### Data Flow

```
User ←→ Cedar Chat UI ←→ Mastra Backend ←→ Agent (Claude)
                              ↓
                        Tool Execution
                              ↓
                    API Routes ←→ Database
                              ↓
                    Cedar State Updates → UI
```

---

## Known Issues to Fix

### 1. Data Model Confusion
**Problem**: Plans, journals, and tasks overlap with unclear semantics (isPlan flag on journal entries).

**Solution**: Separate data stores:
- `plans/` - Scheduled intentions
- `journals/` - What actually happened  
- `tasks/` - Priority queues (have-to-do, want-to-do)

With clear foreign key relationships (plan entries and journal entries can reference taskId).

### 2. Agent Task Reference Confusion
**Problem**: Agent creates new tasks when it should reference existing ones, or vice versa.

**Solution**: 
- Improve agent instructions with clearer decision criteria
- Provide agent with task list context before operations
- Add validation that warns when creating a task similar to existing one

### 3. UI Clarity
**Problem**: Hard to distinguish plan entries from journal entries from staged tasks.

**Solution**: 
- Consistent color coding (documented above)
- Filter toggles to show/hide entry types
- Clear visual hierarchy and legends

---

## Feature Roadmap

### Phase 1: Foundation (Priority)
- [ ] Redesign data model with separate plan/journal stores
- [ ] Migrate from JSON to SQLite database
- [ ] Fix agent task referencing behavior
- [ ] Improve UI color coding and add filter toggles

### Phase 2: Intelligence
- [ ] Duration estimation from historical data
- [ ] Pattern recognition for scheduling suggestions
- [ ] Morning planning and end-of-day review prompts

### Phase 3: Analytics
- [ ] Energy pattern analysis
- [ ] Category/project time breakdowns
- [ ] Streak tracking for daily tasks
- [ ] Plan vs actual comparison views

### Phase 4: Gamification
- [ ] Visual streak counters
- [ ] Progress toward goals
- [ ] Historical self-competition metrics
- [ ] Agent-generated motivational framings

---

## Non-Goals (Out of Scope)

*Not explicitly defined - to be determined based on user needs.*

---

## Appendix: Current Data Structures

### Task File Format (have-to-do.json, want-to-do.json)
```json
{
  "_comment": "Queue structure - first element is highest priority",
  "tasks": [
    {
      "id": "uuid",
      "text": "task description",
      "dueDate": "2025-01-04",
      "isDaily": true
    }
  ]
}
```

### Journal File Format (YYYY-MM-DD.json)
```json
{
  "7am": "",
  "8am": { "text": "Morning routine", "isPlan": false },
  "9am": { "taskId": "uuid", "listType": "have-to-do", "isPlan": true },
  ...
  "ranges": [
    { "start": "2pm", "end": "4pm", "taskId": "uuid", "listType": "want-to-do", "isPlan": true }
  ],
  "staged": [
    { "taskId": "uuid", "listType": "have-to-do", "isPlan": true }
  ],
  "indicators": 2
}
```

