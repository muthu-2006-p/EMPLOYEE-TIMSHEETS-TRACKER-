// AI Chatbot - Llama 3.2 Intelligent Assistant (With Authentication)
(function () {
    'use strict';

    // Chat history storage
    let chatHistory = [];
    let isOpen = false;
    let isTyping = false;
    let lastSendTime = 0;
    const DEBOUNCE_DELAY = 300; // ms

    // Create chatbot HTML structure
    function createChatbotUI() {
        // Toggle Button
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'chatbot-toggle';
        toggleBtn.id = 'chatbot-toggle';
        toggleBtn.innerHTML = `
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.07L2 22l4.93-1.36C8.42 21.5 10.15 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-2h2v2zm2.07-7.75l-.9.92C11.45 10.9 11 11.5 11 13h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H6c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
            </svg>
        `;
        toggleBtn.setAttribute('aria-label', 'Open AI Assistant');
        toggleBtn.onclick = toggleChat;

        // Chat Container
        const container = document.createElement('div');
        container.className = 'chatbot-container';
        container.id = 'chatbot-container';
        container.innerHTML = `
            <div class="chatbot-header">
                <div class="chatbot-avatar">🤖</div>
                <div class="chatbot-info">
                    <h3>Llama 3.2 Assistant</h3>
                    <p>● Online - Personalized Help</p>
                </div>
                <button class="chatbot-close" onclick="toggleChat()" title="Close">&times;</button>
            </div>
            <div class="chatbot-messages" id="chatbot-messages">
                <div class="chat-welcome">
                    <h4>👋 Hi! I'm your Intelligent AI Assistant</h4>
                    <p>I can help you with your timesheets, tasks, attendance, and more!</p>
                    <div class="quick-questions">
                        <button class="quick-question" onclick="askQuestion('How many hours did I log this week?')">📊 My hours this week</button>
                        <button class="quick-question" onclick="askQuestion('Check my timesheets for errors')">🔍 Check for errors</button>
                        <button class="quick-question" onclick="askQuestion('Do I have any upcoming deadlines?')">⏰ Upcoming deadlines</button>
                        <button class="quick-question" onclick="askQuestion('What tasks do I have today?')">✅ Today\\'s tasks</button>
                        <button class="quick-question" onclick="askQuestion('Can you suggest task names for me?')">💡 Suggest tasks</button>
                        <button class="quick-question" onclick="askQuestion('Am I missing any timesheet hours?')">⚠️ Missing hours</button>
                        <button class="quick-question" onclick="askQuestion('What is my leave balance?')">🏖️ Leave balance</button>
                        <button class="quick-question" onclick="askQuestion('How do I submit a timesheet?')">🎓 How to guide</button>
                    </div>
                </div>
            </div>
            <div class="chatbot-input-container">
                <input type="text" class="chatbot-input" id="chatbot-input" 
                       placeholder="Ask me anything about your timesheets, tasks, leaves..." 
                       onkeypress="handleInputKeypress(event)">
                <button class="chatbot-send" id="chatbot-send" onclick="sendMessage()">
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                    </svg>
                </button>
            </div>
        `;

        document.body.appendChild(toggleBtn);
        document.body.appendChild(container);
    }

    // Toggle chat open/close
    window.toggleChat = function () {
        const container = document.getElementById('chatbot-container');
        const toggle = document.getElementById('chatbot-toggle');

        isOpen = !isOpen;

        if (isOpen) {
            container.classList.add('open');
            toggle.classList.add('active');
            toggle.innerHTML = `
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
            `;
            document.getElementById('chatbot-input').focus();
        } else {
            container.classList.remove('open');
            toggle.classList.remove('active');
            toggle.innerHTML = `
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.07L2 22l4.93-1.36C8.42 21.5 10.15 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-2h2v2zm2.07-7.75l-.9.92C11.45 10.9 11 11.5 11 13h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H6c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
                </svg>
            `;
        }
    };

    // Handle Enter key in input
    window.handleInputKeypress = function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    };

    // Ask a quick question
    window.askQuestion = function (question) {
        document.getElementById('chatbot-input').value = question;
        sendMessage();
    };

    // Get authentication token
    function getAuthToken() {
        return localStorage.getItem('auth_token') || localStorage.getItem('token');
    }

    // Send message to AI (WITH AUTHENTICATION)
    window.sendMessage = async function () {
        const input = document.getElementById('chatbot-input');
        const message = input.value.trim();

        if (!message || isTyping) return;

        // Debounce rapid requests
        const now = Date.now();
        if (now - lastSendTime < DEBOUNCE_DELAY) {
            return;
        }
        lastSendTime = now;

        // Clear welcome message on first interaction
        const welcome = document.querySelector('.chat-welcome');
        if (welcome) welcome.remove();

        // Add user message
        addMessage(message, 'user');
        input.value = '';

        // Show typing indicator
        showTyping();

        try {
            // Get auth token
            const token = getAuthToken();

            const response = await fetch('/api/chatbot/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    message: message,
                    history: chatHistory.slice(-10)
                })
            });

            hideTyping();

            if (!token || response.status === 401 || response.status === 403) {
                addMessage('⚠️ Your session has expired. Please refresh the page and log in again.', 'bot');
                return;
            }

            const data = await response.json();

            if (response.ok) {
                // Execute action if present
                if (data.action && typeof window.executeChatbotAction === 'function') {
                    window.executeChatbotAction(data.action);
                }

                // Show cache indicator for debugging (optional)
                const cacheIndicator = data.cached ? ' ⚡' : '';
                addMessage(data.response + cacheIndicator, 'bot');

                // Update history
                chatHistory.push({ role: 'user', content: message });
                chatHistory.push({ role: 'assistant', content: data.response });
            } else {
                addMessage('Sorry, I encountered an error. ' + (data.error || 'Please try again.'), 'bot');
            }
        } catch (error) {
            console.error('Chatbot error:', error);
            hideTyping();
            addMessage('Unable to connect to AI service. Please check if the server is running.', 'bot');
        }
    };

    // Add message to chat
    function addMessage(text, type) {
        const messagesContainer = document.getElementById('chatbot-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${type}`;

        // Format code blocks and markdown
        let formattedText = text
            .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');

        messageDiv.innerHTML = formattedText;

        // Use requestAnimationFrame for smooth rendering
        requestAnimationFrame(() => {
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        });
    }

    // Show typing indicator with estimated time
    function showTyping() {
        isTyping = true;
        const messagesContainer = document.getElementById('chatbot-messages');
        const typingDiv = document.createElement('div');
        typingDiv.className = 'typing-indicator';
        typingDiv.id = 'typing-indicator';
        typingDiv.innerHTML = '<span></span><span></span><span></span>';
        typingDiv.setAttribute('title', 'AI is thinking...');
        messagesContainer.appendChild(typingDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        document.getElementById('chatbot-send').disabled = true;
    }

    // Hide typing indicator
    function hideTyping() {
        isTyping = false;
        const typing = document.getElementById('typing-indicator');
        if (typing) typing.remove();
        document.getElementById('chatbot-send').disabled = false;
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createChatbotUI);
    } else {
        createChatbotUI();
    }
})();
