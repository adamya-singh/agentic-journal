# Agentic Journal - UI/UX Improvement Specification

*Based on in-depth user interview conducted January 2026*

---

## Core Philosophy

### The Central Insight

**Input friction reduction is the #1 priority.** The agent can only be as smart as the data it receives. The goal is to make it effortless to feed information to the application, enabling effective journaling and giving the agent rich context about tasks and productivity to reason over.

### Design Principles

1. **Speed over richness** - Minimal detail is fine; optimize for fast capture
2. **Pattern intelligence** - Agent intelligence comes from recognizing patterns across many simple entries, not from detailed individual entries
3. **Minimal and compact** - Keep the UI clean; avoid clutter while improving scanability
4. **Selective proactivity** - Agent should interrupt only at high-value moments, not constantly

---

## Top 4 Priorities (User-Ranked)

| Priority | Improvement | Impact |
|----------|-------------|--------|
| 1 | **Dark mode** | Daily comfort, reduced eye strain |
| 2 | **Quick-tap buttons to mark tasks complete** | Drastically reduces input friction |
| 3 | **Dedicated evening review flow** | Addresses major workflow friction point |
| 4 | **Agent morning suggestions** | Reduces cognitive load at day start |

---

## Friction Points & Solutions

### Morning Friction
**Problem:** Agent doesn't suggest what to work on today. User has to manually figure out priorities.

**Solution:** Agent morning suggestions
- On app open in morning, agent analyzes:
  - Tasks due today
  - Incomplete tasks from yesterday
  - Task priority positions
  - Historical patterns (when user is most productive for certain task types)
- Agent proposes: "Here's what I suggest for today: [top 3-5 tasks]"
- User can approve, modify, or dismiss

### Midday Friction
**Problem:** Forgetting to log what actually happened. Memory gaps between morning and afternoon.

**Solutions:**
1. **Push notifications** when scheduled task time has passed and not logged
2. **Agent proactive prompts** - "What did you do this past hour?" at key intervals
3. **Quick-log UI** - One-tap way to log common activities

### Scheduling Friction
**Problem:** Assigning specific times to staged tasks requires too many steps.

**Solution:** Agent proposes schedules
- When user has staged tasks, agent suggests: "I can schedule these for you. Here's a proposed schedule based on your patterns..."
- User reviews and approves/tweaks
- Drag-and-drop remains available for manual scheduling

### Evening Friction
**Problem:** No dedicated flow for reviewing the day and handling incomplete tasks.

**Solution:** Dedicated evening review flow
- Triggered by user or agent prompt in evening
- Shows:
  - What was planned vs what actually happened
  - Incomplete tasks with options (reschedule to tomorrow, deprioritize, delete)
  - Quick recap entry field
- Batch triage for multiple incomplete tasks
- Smooth transition to next-day planning

---

## Task List Improvements

### Problem: Wall of Text
Current task lists appear as undifferentiated walls of text, making scanning difficult.

### Solutions

#### 1. Subtle Horizontal Dividers
- Add thin, subtle dividers between task items
- Light gray (#E5E7EB in light mode) to maintain minimal aesthetic
- Provides visual separation without clutter

#### 2. Dynamic Priority Tier Borders
Add colored left border indicating **relative** priority tier:

| Position | Tier | Color |
|----------|------|-------|
| Top 1/3 of list | High priority | Red/Warm (#EF4444) |
| Middle 1/3 of list | Medium priority | Yellow/Amber (#F59E0B) |
| Bottom 1/3 of list | Low priority | Green (#10B981) |

**Key:** This is **dynamic and relative** - tiers adjust automatically as list size changes. A task at position 3 in a 9-item list is high priority, but position 3 in a 30-item list is still high priority (top 10 = top 1/3).

#### Implementation Notes
- Border width: 3-4px
- Apply to left edge of task row
- Smooth color transitions at tier boundaries optional
- Works for both have-to-do and want-to-do lists independently

---

## Week View Improvements

### Today Column Prominence
**Problem:** Today's column has only a subtle indigo highlight. Given the user mostly cares about TODAY, it should be more prominent.

**Solution:** Make today's column physically larger/expanded
- Today column: ~1.5x width of other days
- Or: Show today with more vertical space/detail
- Keep other days compact as reference
- Maintain current indigo highlight for color differentiation

### Other Week View Notes
- Current display for past days is fine - no changes needed
- Week view as primary view works well - don't change hierarchy
- Entry density varies wildly (some days empty, some packed) - design must handle both gracefully

---

## Input Friction Reducers

### Quick-Tap Preset Buttons
Location: Today's task list items and/or floating action bar

**Buttons for tasks:**
- ✓ **Complete** - Mark task as done (highest priority)
- ▶ **Starting now** - Log that you're beginning this task
- ✓ **Just finished** - Log completion with current timestamp

**Buttons for journal logging:**
- Quick-add common entry types without full text input
- Templates for recurring activities

### One-Tap Activity Logging
- Streamlined flow for "I just did X"
- Minimize steps between thought and recorded entry
- Agent can suggest recent/common activities to tap

---

## Agent Behavior Specification

### When to Interrupt (Proactive Moments)
| Trigger | Agent Action |
|---------|--------------|
| Scheduled task time passes without log | Prompt: "Did you complete [task]? Or what happened during that time?" |
| Morning app open | Suggest what to work on today |
| Periodic midday (if enabled) | "What did you do this past hour?" |
| Evening (if review flow enabled) | "Ready to review your day?" |

### When NOT to Interrupt
- Random times without trigger
- While user is actively typing/working in app
- For low-priority suggestions that can wait

### Scheduling Intelligence
When proposing schedules for staged tasks:
- Consider task priority positions
- Consider historical patterns (user's productive hours)
- Consider task duration estimates (if available)
- Present as suggestion, not automatic action
- Allow easy approve/tweak/dismiss

### Verbosity
Current verbosity level is appropriate - no changes needed.
- Terse for quick actions
- More detailed during planning sessions

---

## What Works Well (Don't Change)

These elements tested positively and should be preserved:

| Element | Why It Works |
|---------|--------------|
| **Binary search priority insertion** | "Makes it very easy to prioritize tasks only having to compare two at a time" |
| **Have-to-do vs want-to-do split** | Perfect mental model match for user |
| **Week view as primary** | Good overview without being overwhelming |
| **Sidepanel chat always visible** | Useful for agent interaction |
| **Agent verbosity level** | Right balance of terse and detailed |
| **Current task list information** | Sufficient for scanning needs |
| **Incomplete tasks staying in queue** | Current carryover behavior is correct |
| **Hour blocks for time** | Granularity matches how user thinks |

---

## Journal Entry Behavior

### Entry Types to Support
1. **Task completions** - "Did X task"
2. **Time sinks/distractions** - "Wasted time on Twitter"
3. **Unplanned activities** - "Got pulled into meeting", "Helped coworker"

### Treatment
- **Same treatment for all** - No judgment or different styling for "unproductive" entries
- Log everything neutrally; let the agent notice patterns over time
- Don't visually shame the user for logging distractions

### Detail Level
- **Minimal is sufficient** - Just the activity name is enough
- Don't require structured fields or lengthy descriptions
- Speed of capture > richness of individual entries

---

## Dark Mode Requirements

### Priority
This is the #1 user-ranked improvement.

### Implementation Notes
- Full dark theme for all components
- Respect system preference with manual override option
- Ensure all color-coded elements (priority borders, entry type colors) work in dark mode
- Test contrast ratios for accessibility
- Cedar components need dark mode support

### Color Considerations
- Background: Dark gray (#1F2937 or similar), not pure black
- Text: Light gray (#F3F4F6), not pure white
- Accent colors may need adjustment for dark backgrounds
- Priority tier colors should remain distinguishable

---

## Chat Mode Notes

User uses both sidepanel and caption modes with no pattern - just preference at the moment.

### No Changes Needed
- Mode switching works fine
- No need for auto-switching logic
- Both modes should receive equal attention in improvements

---

## Summary: Implementation Roadmap

### Phase 1: Quick Wins ✅ COMPLETE
1. ~~Dark mode~~ ✅
2. ~~Subtle task dividers~~ ✅
3. ~~Quick-complete buttons on tasks~~ ✅

### Phase 2: Visual Polish
4. Dynamic priority tier borders
5. Today column expansion

### Phase 3: Agent Intelligence
6. Agent morning suggestions
7. Agent midday prompts ("what did you do?")
8. Agent schedule proposals for staged tasks

### Phase 4: Workflow Flows
9. Dedicated evening review flow
10. Push notifications for overdue tasks

---

## Appendix: Interview Insights Summary

### User Workflow
- Mixed capture style (some real-time, some batched)
- Entry density varies wildly by day
- Prefers actuals (journal) over plans
- Uses both chat modes randomly

### Confirmed Design Decisions
- Hour blocks are appropriate granularity
- Two-list split (have/want) is correct model
- Week view as primary is correct
- Minimal task metadata is sufficient
- No extra context fields needed on tasks

### Key Quote
> "The ONE thing that would improve this app the most isn't just a smarter agent, it's reducing the friction and mental effort it takes for me to feed information to the application, letting me journal effectively and giving it as much context as possible about my tasks and productivity to reason over."

