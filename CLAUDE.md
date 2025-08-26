# Claude Code Session Notes - Lecture Redirect System

## Project Overview
A YouTube lecture redirect system for GCC (Glendale Community College) that automatically assigns live streamed lectures to the correct week/lecture slots based on stream titles and dates.

## Class Structure
- **Synchronous Classes** (AVC 185, 200, 240): Fixed Monday/Wednesday schedule
  - Monday = Lecture 1
  - Wednesday = Lecture 2
- **Asynchronous Class** (AVC 285): Flexible posting schedule
  - Sequential assignment regardless of day posted
  - Always exactly 2 lectures per week
  - First stream of week = Lecture 1, second stream = Lecture 2

## Stream Title Format
Expected format: `AVC [CLASS]: [M/D/YYYY]`
Examples:
- `AVC 185: 8/25/2025`
- `AVC 240: 8/25/2025` 
- `AVC 200: 8/25/2025`
- `AVC 285: 8/27/2025`

## Issues Found and Fixed

### 1. Class-Specific Assignment Bug (FIXED)
**Problem**: The `updateIndexContent()` function was updating the first occurrence of a lecture key across ALL classes, causing multiple streams to overwrite the same slot.

**Root Cause**: 
```javascript
// OLD - searches entire file for first match
const pattern = new RegExp(`('${lectureKey}':\\s*')[^']+(')`);
```

**Solution**: 
```javascript
// NEW - searches within specific class section only
const classPattern = new RegExp(`('${classKey}':\\s*\\{[\\s\\S]*?)'${lectureKey}':\\s*'[^']+'`, 'g');
```

### 2. Week Calculation Alignment (FIXED)
**Problem**: Semester start date was 8/18, making 8/25 lectures appear as Week 2.

**Solution**: Changed semester start to 8/24 so the week of 8/24 is Week 1.
- Updated in both `.github/workflows/youtube-monitor.yml` and `.github/scripts/youtube-monitor.js`

### 3. AVC 285 Assignment Logic (ENHANCED)
**Problem**: Day-based assignment didn't work for asynchronous class with flexible posting schedule.

**Solution**: Added sequential assignment logic specifically for AVC 285:
```javascript
function determineLectureNumber(streamDate, classKey, week, indexContent) {
    // Special handling for AVC 285 - sequential assignment regardless of day
    if (classKey === 'avc285') {
        return getNextAvailableLecture(classKey, week, indexContent);
    }
    // Regular day-based assignment for synchronous classes
    // ...
}
```

## System Architecture

### HTML Structure
```javascript
lectureLinks = {
    'avc185': { 'week1-lecture1': '...', 'week1-lecture2': '...' },
    'avc200': { 'week1-lecture1': '...', 'week1-lecture2': '...' },
    'avc240': { 'week1-lecture1': '...', 'week1-lecture2': '...' },
    'avc285': { 'week1-lecture1': '...', 'week1-lecture2': '...' }
}
```

### GitHub Action Workflow
- Runs every 15 minutes during semester
- Searches YouTube API for videos published in last 7 days
- Parses stream titles for class and date
- Assigns to appropriate week/lecture slots
- Only updates empty slots (doesn't overwrite existing assignments)
- Commits changes automatically

### Key Configuration
```javascript
CLASS_SCHEDULE: {
    'avc185': [1, 3], // Monday, Wednesday (synchronous)
    'avc200': [1, 3], // Monday, Wednesday (synchronous)
    'avc240': [1, 3], // Monday, Wednesday (synchronous)
    'avc285': [1, 2, 3, 4]  // Monday-Thursday flexible (asynchronous)
}
```

## Current Semester Settings
- Start: 2025-08-24 (Week of 8/24 = Week 1)
- End: 2025-12-18

## Testing Results
All three fixes have been tested and verified:
1. ✅ Class-specific assignment works correctly
2. ✅ Week calculation properly assigns 8/25 streams to Week 1
3. ✅ AVC 285 sequential assignment handles flexible posting schedule

## Future Semester Setup
When the semester changes and system resets, classify new classes as either:
- **Synchronous**: `[1, 3]` for fixed Monday/Wednesday schedule
- **Asynchronous**: `[1, 2, 3, 4]` for flexible posting with sequential assignment

Update the `CLASS_SCHEDULE` configuration in `.github/scripts/youtube-monitor.js` accordingly.

## Commands to Remember
- Manual trigger: GitHub Actions → "YouTube Stream Monitor" → "Run workflow"
- Diagnostic: `node debug-youtube.js` (with API credentials set)
- Test parsing: Various test scripts created during session

## Admin Interface
- Available at: `admin.html` 
- Allows manual assignment/reassignment of lecture links
- Auto-monitor won't overwrite existing assignments