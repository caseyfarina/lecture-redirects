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

### 4. Admin Panel Class-Specific Update Bug (FIXED)
**Problem**: Admin panel `updateSingleWeek` function used global regex patterns, causing cross-class lecture URL contamination when updating individual weeks.

**Root Cause**:
```javascript
// OLD - searches entire file for first match
const lecturePattern = new RegExp(`('${lectureKey}':\\s*')[^']+(')`);
```

**Solution**:
```javascript  
// NEW - searches within specific class section only
const classSpecificPattern = new RegExp(`('${currentClass}':\\s*\\{[\\s\\S]*?)('${lectureKey}':\\s*')[^']+(')`);
```

### 5. Video Reassignment Prevention (FIXED)
**Problem**: When admin manually overwrites an auto-assigned video, GitHub Action would reassign the displaced video to the next available slot on subsequent runs.

**Solution**: Added video ID tracking to prevent reassignment of existing videos:
```javascript
function getExistingVideoIds(indexContent) {
    // Extract all video IDs that already exist in the database
    const videoIds = new Set();
    const videoPattern = /youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/g;
    // ... extract and return all existing video IDs
}

// CONFLICT PREVENTION: Skip if video already exists in database
if (existingVideoIds.has(videoId)) {
    console.log(`Skipping - video ${videoId} already exists in database (prevents reassignment)`);
    continue;
}
```

### 6. Schedule Optimization (ENHANCED)  
**Problem**: Every 15 minutes + 7-day window was excessive, causing 96 runs/day and processing same videos up to 672 times.

**Solution**: Optimized for Arizona teaching schedule:
- **Timing**: 7:30 AM and 7:30 PM Arizona time (perfect for 8 AM - 6:30 PM class schedule)
- **Window**: Reduced from 7 days to 2 days  
- **Efficiency**: 98% reduction in runs (2/day vs 96/day)
- **API Usage**: Dramatically reduced YouTube API calls
- **Commit History**: Clean twice-daily commits instead of constant updates

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
- **Optimized Schedule**: Runs twice daily at 7:30 AM and 7:30 PM Arizona time
- **Smart Window**: Searches YouTube API for videos published in last 2 days  
- **Video Processing**: Parses stream titles for class and date
- **Conflict Prevention**: Skips videos already in database (prevents reassignments)
- **Assignment Logic**: Assigns to appropriate week/lecture slots
- **Slot Protection**: Only updates empty slots (doesn't overwrite existing assignments)
- **Auto-commit**: Commits changes automatically with clean history

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

## Conflict Prevention System
Added comprehensive conflict prevention between GitHub Action and Admin Panel:

### GitHub Action Protection:
- **Video ID Tracking**: Scans entire database for existing video IDs before processing
- **Skip Existing Videos**: If video already assigned anywhere, skips processing entirely  
- **No Reassignment**: Prevents displaced videos from being pushed to next available slot
- **New Videos Only**: Only assigns truly NEW videos not found in database

### Admin Panel Workflow:
- Admin can safely overwrite any auto-assigned video
- Displaced videos will NOT be reassigned by future GitHub Action runs
- Manual corrections take permanent precedence over automation

## Database Location and Updates
**IMPORTANT**: The HTML database is stored on GitHub, not locally. When checking current lecture links, always check the live GitHub repository:
- **Live Database**: https://raw.githubusercontent.com/caseyfarina/lecture-redirects/main/index.html
- **Local files are NOT the source of truth** - they may be outdated

The redirect links are updated through:
1. **GitHub Action** - Automatically assigns new YouTube streams based on upload dates/titles
2. **Admin Panel** - Manual assignments via the web interface at the GitHub Pages site

When troubleshooting redirect issues, always verify the current state of the GitHub database, not local files.

## Admin Interface
- Available at: `admin.html` 
- Allows manual assignment/reassignment of lecture links
- Protected by conflict prevention system