// Employee Messages & Notifications Handler
// Clean, corrected implementation: handles warnings, meetings, feedback and replies.

let currentReplyFeedbackId = null;
let _lastFeedbackList = [];

// Toggle messages modal
function toggleMessages() {
    const modal = document.getElementById('messagesModal');
    if (!modal) return;
    if (modal.style.display === 'none' || !modal.style.display) {
        modal.style.display = 'flex';
        modal.style.flexDirection = 'column';
        loadEmployeeMessages();
    } else {
        modal.style.display = 'none';
    }
}

function closeMessages() {
    const modal = document.getElementById('messagesModal');
    if (modal) modal.style.display = 'none';
}

function closeReplyModal() {
    const modal = document.getElementById('replyFeedbackModal');
    if (modal) modal.style.display = 'none';
    currentReplyFeedbackId = null;
}

// Load messages for current user and categorize
async function loadEmployeeMessages() {
    try {
        const feedback = await apiCall('/feedback/me');
        console.log('📬 Feedback loaded:', feedback);
        if (!Array.isArray(feedback)) {
            console.error('Invalid feedback response');
            return;
        }
        // keep copy for handlers
        _lastFeedbackList = feedback;

        const warnings = [];
        const meetings = [];
        const feedbackMsgs = [];

        for (const msg of feedback) {
            const subj = (msg.subject || '').toLowerCase();
            const textHasHttp = (msg.message || '').includes('http');
            if (subj.includes('warning') || subj.includes('urgent') || subj.includes('alert')) {
                warnings.push(msg);
            } else if (subj.includes('meeting') || subj.includes('invite') || textHasHttp) {
                meetings.push(msg);
            } else {
                feedbackMsgs.push(msg);
            }
        }

        console.log(`📊 Categorized: ${warnings.length} warnings, ${meetings.length} meetings, ${feedbackMsgs.length} feedback`);
        renderWarningsSection(warnings);
        renderMeetingLinksSection(meetings);
        renderFeedbackSection(feedbackMsgs);

        updateMessageBadge(warnings.length + meetings.length + feedbackMsgs.length);
    } catch (err) {
        console.error('Error loading messages:', err);
        const mc = document.getElementById('messagesContainer');
        if (mc) mc.innerHTML = '<p class="muted" style="color: #f97316;">Failed to load messages</p>';
    }
}

function renderWarningsSection(warnings) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    if (!warnings.length) return container.innerHTML = '<p class="muted">✓ No warnings or messages</p>';

    container.innerHTML = warnings.map(msg => {
        const fromName = msg.from ? .name || msg.from ? .email || 'Manager';
        const ts = msg.createdAt ? new Date(msg.createdAt).toLocaleString() : 'Recent';
        return `
            <div style="background: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; padding: 12px; border-radius: 6px; margin-bottom: 10px;">
                <div style="font-weight:700; color:#ef4444;">⚠️ ${escapeHtml(msg.subject || 'Warning')}</div>
                <div class="muted" style="font-size:13px; margin-top:6px">From: ${escapeHtml(fromName)}</div>
                <div style="margin-top:8px; color:#ccc">${escapeHtml(msg.message || 'No message')}</div>
                <div class="muted" style="font-size:12px; margin-top:6px">${ts}</div>
            </div>
        `;
    }).join('');
}

function renderMeetingLinksSection(meetings) {
    const container = document.getElementById('meetingLinksContainer');
    if (!container) return;
    if (!meetings.length) return container.innerHTML = '<p class="muted">📭 No meeting invitations</p>';

    container.innerHTML = meetings.map(msg => {
                const fromName = msg.from ? .name || msg.from ? .email || 'Manager';
                const ts = msg.createdAt ? new Date(msg.createdAt).toLocaleString() : 'Recent';
                const urlMatch = msg.message ? msg.message.match(/(https?:\/\/[^\s]+)/) : null;
                const link = urlMatch ? urlMatch[0] : '';
                // encode link into data attribute
                const safeLink = encodeURIComponent(link);
                return `
            <div style="background: rgba(110,231,183,0.1); border-left:4px solid #6EE7B7; padding:12px; border-radius:6px; margin-bottom:10px;">
                <div style="font-weight:700">${escapeHtml(msg.subject || 'Meeting Invitation')}</div>
                <div class="muted" style="font-size:13px; margin-top:6px">From: ${escapeHtml(fromName)}</div>
                <div style="margin-top:8px; color:#ccc">${escapeHtml(msg.message || 'Check meeting details')}</div>
                ${link ? `<div style="margin-top:8px"><button class="btn small joinMeetingBtn" data-id="${msg._id}" data-link="${safeLink}">🔗 Join Meeting</button></div>` : ''}
                <div class="muted" style="font-size:12px; margin-top:6px">${ts}</div>
            </div>
        `;
    }).join('');

    // attach listeners
    const btns = container.querySelectorAll('.joinMeetingBtn');
    btns.forEach(b => b.addEventListener('click', (e) => {
        const id = b.getAttribute('data-id');
        const link = decodeURIComponent(b.getAttribute('data-link') || '');
        joinMeeting(id, link);
    }));
}

function renderFeedbackSection(feedback) {
    const container = document.getElementById('feedbackContainer');
    if (!container) return;
    if (!feedback.length) return container.innerHTML = '<p class="muted">💬 No feedback messages</p>';

    container.innerHTML = feedback.map(msg => {
        const fromName = msg.from?.name || msg.from?.email || 'Unknown';
        const ts = msg.createdAt ? new Date(msg.createdAt).toLocaleString() : 'Recent';
        return `
            <div style="background: rgba(245,158,11,0.08); border-left:4px solid #F59E0B; padding:12px; border-radius:6px; margin-bottom:10px;">
                <div style="font-weight:700">${escapeHtml(msg.subject || 'Feedback')}</div>
                <div class="muted" style="font-size:13px; margin-top:6px">From: ${escapeHtml(fromName)}</div>
                <div style="margin-top:8px; color:#ccc">${escapeHtml(msg.message || 'No message')}</div>
                <div style="margin-top:8px"><button class="btn small replyBtn" data-id="${msg._id}">💬 Reply</button></div>
                <div class="muted" style="font-size:12px; margin-top:6px">${ts}</div>
            </div>
        `;
    }).join('');

    // attach reply handlers
    const replyBtns = container.querySelectorAll('.replyBtn');
    replyBtns.forEach(b => b.addEventListener('click', async () => {
        const id = b.getAttribute('data-id');
        if (!id) return alert('Message id missing');
        // find original message from stored inbox
        const original = Array.isArray(_lastFeedbackList) ? _lastFeedbackList.find(f => f._id === id) : null;
        openReplyModalByOriginal(original);
    }));
}

function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>\"']/g, function (c) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c];
    });
}

// join meeting: open link then send acknowledgement to original sender
async function joinMeeting(messageId, meetingLink) {
    try {
        if (meetingLink) {
            const win = window.open(meetingLink, '_blank');
            if (!win) console.warn('Popup blocked');
        }
        // find original message and sender
        const original = Array.isArray(_lastFeedbackList) ? _lastFeedbackList.find(f => f._id === messageId) : null;
        const senderEmail = original?.from?.email;
        if (senderEmail) {
            const me = getUser();
            const name = me.name || me.email || 'Participant';
            const ack = `${name} joined meeting: ${original.subject || ''} at ${new Date().toLocaleString()}`;
            // fire-and-forget
            apiCall('/feedback', 'POST', { to: senderEmail, subject: '🟢 Meeting: Joined', message: ack }).catch(e => console.error('Ack failed', e));
        }
        // refresh
        loadEmployeeMessages();
    } catch (err) {
        console.error('joinMeeting error', err);
    }
}

// reply flow
function openReplyModalByOriginal(original) {
    currentReplyFeedbackId = original?._id || null;
    const modal = document.getElementById('replyFeedbackModal');
    if (!modal) return alert('Reply modal not available');
    if (!original) {
        document.getElementById('replyFromInfo').textContent = 'From: Unknown';
        document.getElementById('replySubjectInfo').textContent = 'Re: Feedback';
        document.getElementById('replyMessageInfo').textContent = '';
    } else {
        const fromName = original.from?.name || original.from?.email || 'Unknown';
        document.getElementById('replyFromInfo').textContent = `From: ${fromName}`;
        document.getElementById('replySubjectInfo').textContent = `Re: ${original.subject || 'Feedback'}`;
        document.getElementById('replyMessageInfo').textContent = original.message || '';
    }
    document.getElementById('replyText').value = '';
    modal.style.display = 'flex';
}

async function sendFeedbackReply() {
    if (!currentReplyFeedbackId) return alert('No feedback selected');
    const replyText = document.getElementById('replyText').value.trim();
    if (!replyText) return alert('Please type a reply');
    try {
        const original = Array.isArray(_lastFeedbackList) ? _lastFeedbackList.find(f => f._id === currentReplyFeedbackId) : null;
        if (!original || !original.from?.email) return alert('Original sender not found');
        await apiCall('/feedback', 'POST', { to: original.from.email, subject: `Re: ${original.subject || 'Feedback'}`, message: replyText });
        alert('Reply sent');
        closeReplyModal();
        await loadEmployeeMessages();
        const fb = await apiCall('/feedback/me');
        updateMessageBadge(Array.isArray(fb) ? fb.length : 0);
    } catch (err) {
        console.error('sendFeedbackReply error', err);
        alert('Failed to send reply');
    }
}

function updateMessageBadge(count) {
    const badge = document.getElementById('msgBadge');
    if (!badge) return;
    badge.textContent = count > 0 ? count : '0';
    badge.style.display = count > 0 ? 'flex' : 'none';
}

// initial badge load
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const feedback = await apiCall('/feedback/me');
        if (Array.isArray(feedback)) updateMessageBadge(feedback.length);
    } catch (err) {
        console.error('Error loading message count', err);
    }
});