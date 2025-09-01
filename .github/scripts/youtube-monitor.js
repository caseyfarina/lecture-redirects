const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const CONFIG = {
    SEMESTER_START: process.env.SEMESTER_START || '2025-08-24',
    SEMESTER_END: process.env.SEMESTER_END || '2025-12-15',
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
    YOUTUBE_CHANNEL_ID: process.env.YOUTUBE_CHANNEL_ID,
    RECIPIENT_EMAILS: (process.env.RECIPIENT_EMAILS || '').split(','),
    CLASSES: {
        'AVC185': 'avc185',
        'AVC 185': 'avc185',
        'AVC200': 'avc200', 
        'AVC 200': 'avc200',
        'AVC240': 'avc240',
        'AVC 240': 'avc240',
        'AVC285': 'avc285',
        'AVC 285': 'avc285'
    },
    CLASS_SCHEDULE: {
        // Monday = 1, Tuesday = 2, Wednesday = 3, Thursday = 4, Friday = 5
        'avc185': [1, 3], // Monday, Wednesday
        'avc200': [1, 3], // Monday, Wednesday  
        'avc240': [1, 3], // Monday, Wednesday
        'avc285': [1, 2, 3, 4]  // Monday-Thursday flexible (async class)
    }
};

// Utility functions
function makeHttpsRequest(url) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Request timeout after 30 seconds'));
        }, 30000);
        
        https.get(url, (res) => {
            clearTimeout(timeout);
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (e) {
                    resolve(data);
                }
            });
        }).on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
}

async function makeHttpsRequestWithRetry(url, maxRetries = 3, context = 'API call') {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🔄 ${context} - Attempt ${attempt}/${maxRetries}`);
            const result = await makeHttpsRequest(url);
            
            // Check for API errors in response
            if (result && result.error) {
                throw new Error(`API Error: ${result.error.message || 'Unknown API error'}`);
            }
            
            console.log(`✅ ${context} successful`);
            return result;
        } catch (error) {
            console.warn(`⚠️ ${context} attempt ${attempt} failed:`, error.message);
            
            if (attempt === maxRetries) {
                console.error(`❌ All ${context} attempts failed after ${maxRetries} tries`);
                throw new Error(`${context} failed: ${error.message}`);
            }
            
            // Exponential backoff: 2s, 4s, 8s
            const waitTime = Math.pow(2, attempt) * 1000;
            console.log(`⏳ Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

function parseStreamDate(title) {
    // Parse format: "AVC185 8/12/2025" or "AVC 185 8/12/2025"
    const dateMatch = title.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (!dateMatch) return null;
    
    const [month, day, year] = dateMatch[1].split('/');
    return new Date(year, month - 1, day);
}

function parseClassName(title) {
    // Parse "AVC185" or "AVC 185"
    for (const [pattern, classKey] of Object.entries(CONFIG.CLASSES)) {
        if (title.toUpperCase().includes(pattern)) {
            return classKey;
        }
    }
    return null;
}

function calculateWeekNumber(streamDate, semesterStart) {
    const start = new Date(semesterStart);
    const diffTime = streamDate.getTime() - start.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return Math.floor(diffDays / 7) + 1;
}

function determineLectureNumber(streamDate, classKey, week, indexContent) {
    // Special handling for AVC 285 - sequential assignment regardless of day
    if (classKey === 'avc285') {
        return getNextAvailableLecture(classKey, week, indexContent);
    }
    
    // Regular day-based assignment for other classes
    const dayOfWeek = streamDate.getDay() === 0 ? 7 : streamDate.getDay(); // Convert Sunday from 0 to 7
    const schedule = CONFIG.CLASS_SCHEDULE[classKey];
    
    if (!schedule) return 1; // Default to lecture 1
    
    const lectureIndex = schedule.indexOf(dayOfWeek);
    return lectureIndex >= 0 ? lectureIndex + 1 : 1;
}

function getNextAvailableLecture(classKey, week, indexContent) {
    // Check which lecture slots are already filled for AVC 285 in this week
    for (let lectureNum = 1; lectureNum <= 2; lectureNum++) {
        const lectureKey = `week${week}-lecture${lectureNum}`;
        const existingPattern = new RegExp(`'${classKey}':\\s*\\{[\\s\\S]*?'${lectureKey}':\\s*'([^']+)'`);
        const existingMatch = indexContent.match(existingPattern);
        
        // If slot is empty or has placeholder, use this slot
        if (!existingMatch || existingMatch[1].includes('not-found.html')) {
            return lectureNum;
        }
    }
    
    // If both slots are filled, default to lecture 1 (shouldn't happen normally)
    return 1;
}

async function getRecentStreams() {
    // Search for videos from last 2 days (optimized window for twice-daily runs)
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?key=${CONFIG.YOUTUBE_API_KEY}&channelId=${CONFIG.YOUTUBE_CHANNEL_ID}&part=snippet&order=date&type=video&maxResults=50&publishedAfter=${new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()}`;
    
    console.log('Fetching recent videos from YouTube...');
    
    try {
        const response = await makeHttpsRequestWithRetry(searchUrl, 3, 'YouTube Search API');
        
        let items = response.items || [];
        console.log(`Found ${items.length} videos from search API`);
        
        // For more comprehensive coverage, also check the channel's upload playlist
        // This helps catch videos that might not appear in search results immediately
        try {
            const channelUrl = `https://www.googleapis.com/youtube/v3/channels?key=${CONFIG.YOUTUBE_API_KEY}&id=${CONFIG.YOUTUBE_CHANNEL_ID}&part=contentDetails`;
            const channelResponse = await makeHttpsRequestWithRetry(channelUrl, 3, 'YouTube Channel API');
            
            if (channelResponse.items && channelResponse.items[0]) {
                const uploadsPlaylistId = channelResponse.items[0].contentDetails.relatedPlaylists.uploads;
                const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?key=${CONFIG.YOUTUBE_API_KEY}&playlistId=${uploadsPlaylistId}&part=snippet&order=date&maxResults=20`;
                
                const playlistResponse = await makeHttpsRequestWithRetry(playlistUrl, 3, 'YouTube Playlist API');
                const playlistItems = playlistResponse.items || [];
                
                console.log(`Found ${playlistItems.length} videos from uploads playlist`);
                
                // Filter playlist items to only include recent videos and convert format
                const recentPlaylistItems = playlistItems
                    .filter(item => {
                        const publishedDate = new Date(item.snippet.publishedAt);
                        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
                        return publishedDate > twoDaysAgo;
                    })
                    .map(item => ({
                        id: { videoId: item.snippet.resourceId.videoId },
                        snippet: item.snippet
                    }));
                
                // Merge and deduplicate by video ID
                const allVideoIds = new Set(items.map(item => item.id.videoId));
                recentPlaylistItems.forEach(item => {
                    if (!allVideoIds.has(item.id.videoId)) {
                        items.push(item);
                        allVideoIds.add(item.id.videoId);
                    }
                });
                
                console.log(`Total unique videos after merge: ${items.length}`);
            }
        } catch (playlistError) {
            console.log('Could not fetch uploads playlist, using search results only:', playlistError.message);
        }
        
        return items;
    } catch (error) {
        console.error('Error fetching YouTube videos:', error);
        throw error;
    }
}

function getCurrentIndexContent() {
    const indexPath = path.join(process.cwd(), 'index.html');
    try {
        if (!fs.existsSync(indexPath)) {
            throw new Error(`Index file not found: ${indexPath}`);
        }
        const content = fs.readFileSync(indexPath, 'utf8');
        if (!content || content.trim().length === 0) {
            throw new Error('Index file is empty or corrupted');
        }
        return content;
    } catch (error) {
        console.error('❌ Failed to read index.html:', error.message);
        console.error('This will prevent lecture assignments from working');
        throw error; // Re-throw so GitHub Action fails cleanly
    }
}

function updateIndexContent(content, classKey, week, lecture, videoUrl) {
    const lectureKey = `week${week}-lecture${lecture}`;
    
    // Create a class-specific pattern that looks for the lecture within the correct class section
    // This finds the class section and then the specific lecture within it
    const classPattern = new RegExp(`('${classKey}':\\s*\\{[\\s\\S]*?)'${lectureKey}':\\s*'[^']+'`, 'g');
    
    console.log(`Updating ${classKey} ${lectureKey} with ${videoUrl}`);
    
    // Replace the lecture URL within the specific class section
    return content.replace(classPattern, (match) => {
        return match.replace(new RegExp(`'${lectureKey}':\\s*'[^']+'`), `'${lectureKey}': '${videoUrl}'`);
    });
}

function writeIndexContent(content) {
    const indexPath = path.join(process.cwd(), 'index.html');
    try {
        if (!content || typeof content !== 'string') {
            throw new Error('Invalid content provided to write function');
        }
        
        // Create backup before writing
        const backupPath = `${indexPath}.backup`;
        if (fs.existsSync(indexPath)) {
            fs.copyFileSync(indexPath, backupPath);
            console.log('📋 Created backup of index.html');
        }
        
        fs.writeFileSync(indexPath, content, 'utf8');
        console.log('✅ Successfully updated index.html');
    } catch (error) {
        console.error('❌ Failed to write index.html:', error.message);
        console.error('Lecture assignments could not be saved');
        throw error;
    }
}

async function sendNotificationEmail(assignments) {
    if (!assignments.length) return;
    
    const subject = `YouTube Auto-Assignment Report - ${new Date().toLocaleDateString()}`;
    const body = `
Today's Stream Assignments:
${assignments.map(a => `✅ ${a.title} → Week ${a.week}, Lecture ${a.lecture}`).join('\n')}

All assignments completed successfully.
View updated lecture library: https://caseyfarina.github.io/lecture-redirects/admin.html

Automatically generated by YouTube Stream Monitor
`;

    console.log('Email notification would be sent:', { subject, body });
    // Email implementation would go here using nodemailer or similar
}

function getExistingVideoIds(indexContent) {
    // Extract all video IDs that already exist in the database
    const videoIds = new Set();
    const videoPattern = /youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/g;
    let match;
    
    while ((match = videoPattern.exec(indexContent)) !== null) {
        videoIds.add(match[1]);
    }
    
    console.log(`Found ${videoIds.size} existing video IDs in database`);
    return videoIds;
}

async function notifyOfFailure(error) {
    try {
        const subject = `🚨 Lecture Assignment Action Failed - ${new Date().toLocaleDateString()}`;
        const body = `
The YouTube lecture assignment automation failed:

Error: ${error.message}

Please check the GitHub Actions tab for details:
https://github.com/caseyfarina/lecture-redirects/actions

The system will try again at the next scheduled time (12 hours).

Action Time: ${new Date().toISOString()}
`;
        
        console.log('📧 Failure notification would be sent:', { subject, body });
        // Email implementation would go here using nodemailer or similar
        // For now, we log the notification details
    } catch (notifyError) {
        console.error('Failed to send failure notification:', notifyError.message);
    }
}

function validateConfig() {
    const required = [
        { key: 'YOUTUBE_API_KEY', value: CONFIG.YOUTUBE_API_KEY, name: 'YouTube API Key' },
        { key: 'YOUTUBE_CHANNEL_ID', value: CONFIG.YOUTUBE_CHANNEL_ID, name: 'YouTube Channel ID' },
        { key: 'SEMESTER_START', value: CONFIG.SEMESTER_START, name: 'Semester Start Date' },
        { key: 'SEMESTER_END', value: CONFIG.SEMESTER_END, name: 'Semester End Date' }
    ];
    
    const missing = required.filter(item => !item.value || item.value.trim() === '');
    
    if (missing.length > 0) {
        const missingNames = missing.map(item => item.name).join(', ');
        throw new Error(`Missing required configuration: ${missingNames}`);
    }
    
    // Validate date format
    const startDate = new Date(CONFIG.SEMESTER_START);
    const endDate = new Date(CONFIG.SEMESTER_END);
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid semester dates - must be in YYYY-MM-DD format');
    }
    
    if (startDate >= endDate) {
        throw new Error('Semester start date must be before end date');
    }
    
    console.log('✅ Configuration validated successfully');
}

async function main() {
    console.log('🤖 Starting YouTube Stream Monitor...');
    console.log(`Semester: ${CONFIG.SEMESTER_START} to ${CONFIG.SEMESTER_END}`);
    
    try {
        // Validate configuration before starting
        validateConfig();
        
        // Get recent streams
        const streams = await getRecentStreams();
        console.log(`Found ${streams.length} recent streams`);
        
        if (!streams.length) {
            console.log('No recent streams found - action completed successfully');
            return;
        }
        
        // Get current index.html content
        let indexContent = getCurrentIndexContent();
        
        // Get all video IDs that already exist in database (CONFLICT PREVENTION)
        const existingVideoIds = getExistingVideoIds(indexContent);
        
        const assignments = [];
        
        // Process each stream
        for (const stream of streams) {
            const title = stream.snippet.title;
            const videoId = stream.id.videoId;
            console.log(`Processing: ${title} (${videoId})`);
            
            // CONFLICT PREVENTION: Skip if video already exists in database
            if (existingVideoIds.has(videoId)) {
                console.log(`🚫 CONFLICT PREVENTION: Skipping video ${videoId} - already exists in database`);
                console.log(`   Title: ${title}`);
                console.log(`   This prevents duplicate assignments and cross-class contamination`);
                continue;
            }
            
            // Parse stream info
            const classKey = parseClassName(title);
            const streamDate = parseStreamDate(title);
            
            if (!classKey || !streamDate) {
                console.log(`Skipping - unable to parse class/date from: ${title}`);
                continue;
            }
            
            // 🛡️ BULLETPROOF CLASS VALIDATION FAILSAFE
            // Ensure video title actually contains the class it's being assigned to
            const titleUpper = title.toUpperCase();
            let classValidated = false;
            
            if (classKey === 'avc185' && (titleUpper.includes('AVC185') || titleUpper.includes('AVC 185'))) {
                classValidated = true;
            } else if (classKey === 'avc200' && (titleUpper.includes('AVC200') || titleUpper.includes('AVC 200'))) {
                classValidated = true;
            } else if (classKey === 'avc240' && (titleUpper.includes('AVC240') || titleUpper.includes('AVC 240'))) {
                classValidated = true;
            } else if (classKey === 'avc285' && (titleUpper.includes('AVC285') || titleUpper.includes('AVC 285'))) {
                classValidated = true;
            }
            
            if (!classValidated) {
                console.log(`🚫 CLASS VALIDATION FAILED: Video "${title}" assigned to ${classKey.toUpperCase()} but title doesn't contain that class name`);
                console.log(`   This prevents cross-class contamination - video will be skipped`);
                continue;
            }
            
            console.log(`✅ Class validation passed: ${title} → ${classKey.toUpperCase()}`);
            
            
            // Calculate week and lecture numbers
            const week = calculateWeekNumber(streamDate, CONFIG.SEMESTER_START);
            const lecture = determineLectureNumber(streamDate, classKey, week, indexContent);
            
            // Check if this lecture slot is already filled (within the specific class section)
            const lectureKey = `week${week}-lecture${lecture}`;
            const existingPattern = new RegExp(`'${classKey}':\\s*\\{[\\s\\S]*?'${lectureKey}':\\s*'([^']+)'`);
            const existingMatch = indexContent.match(existingPattern);
            
            if (existingMatch && !existingMatch[1].includes('not-found.html')) {
                console.log(`Skipping - ${classKey} ${lectureKey} already has content: ${existingMatch[1]}`);
                continue;
            }
            
            // Build YouTube URL
            const videoUrl = `https://www.youtube.com/watch?v=${stream.id.videoId}`;
            
            // Update content
            indexContent = updateIndexContent(indexContent, classKey, week, lecture, videoUrl);
            
            // CRITICAL: Add this video ID to existing set to prevent duplicate assignments in same run
            existingVideoIds.add(videoId);
            console.log(`✅ Added ${videoId} to existing IDs to prevent duplicate assignment`);
            
            assignments.push({
                title,
                classKey,
                week,
                lecture,
                videoUrl,
                streamDate
            });
        }
        
        // Save changes if any assignments were made
        if (assignments.length > 0) {
            writeIndexContent(indexContent);
            console.log(`✅ Updated ${assignments.length} lecture assignments`);
            
            // Send notification email (Monday/Wednesday/Friday)
            const today = new Date().getDay();
            if ([1, 3, 5].includes(today)) { // Mon, Wed, Fri
                await sendNotificationEmail(assignments);
            }
        } else {
            console.log('No new assignments made - action completed successfully');
        }
        
        console.log('✅ YouTube Stream Monitor completed successfully');
        
    } catch (error) {
        console.error('❌ Error in YouTube monitor:', error.message);
        console.error('📊 Error details:', {
            timestamp: new Date().toISOString(),
            error: error.message,
            stack: error.stack
        });
        
        // Send notification about failure
        await notifyOfFailure(error);
        
        // Exit with error code to fail the GitHub Action
        console.error('🚨 ACTION FAILED - GitHub Action will show as failed');
        process.exit(1);
    }
}

// Run the monitor
main();