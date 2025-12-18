/**
 * Chatbot Action Executor
 * Executes UI actions based on chatbot commands
 */

(function () {
    'use strict';

    // Action Registry - Maps action targets to actual implementations
    const ACTION_REGISTRY = {
        navigate: {
            'employee-dashboard': '/employee.html',
            'manager-dashboard': '/manager.html',
            'admin-dashboard': '/admin.html',
            'timesheets-page': '/employee.html#timesheets',
            'tasks-page': '/employee.html#tasks',
            'attendance-page': '/employee.html#attendance',
            'profile-page': '/employee.html#profile',
            'home': '/home.html'
        },

        click: {
            // Common button selectors
            '#addTimesheetBtn': true,
            '#checkInBtn': true,
            '#checkOutBtn': true,
            '#submitTimesheetBtn': true,
            '#addTaskBtn': true,
            '#viewReportsBtn': true
        },

        scroll: {
            'timesheets-section': '#timesheetsSection',
            'tasks-section': '#tasksSection',
            'attendance-section': '#attendanceSection',
            'reports-section': '#reportsSection',
            'profile-section': '#profileSection'
        },

        open_modal: {
            'add-timesheet': () => {
                const btn = document.querySelector('#addTimesheetBtn');
                if (btn) btn.click();
            },
            'edit-timesheet': () => {
                const btn = document.querySelector('.edit-timesheet-btn');
                if (btn) btn.click();
            },
            'add-task': () => {
                const btn = document.querySelector('#addTaskBtn');
                if (btn) btn.click();
            }
        }
    };

    /**
     * Execute an action command from the chatbot
     * @param {Object} actionData - {action: 'navigate', target: 'employee-dashboard'}
     */
    window.executeChatbotAction = function (actionData) {
        if (!actionData || !actionData.action) {
            console.warn('Invalid action data:', actionData);
            return false;
        }

        const { action, target, element, modal } = actionData;

        try {
            switch (action) {
                case 'navigate':
                    return executeNavigate(target);

                case 'click':
                    return executeClick(element);

                case 'scroll':
                    return executeScroll(target);

                case 'open_modal':
                    return executeOpenModal(modal);

                default:
                    console.warn('Unknown action:', action);
                    return false;
            }
        } catch (error) {
            console.error('Action execution error:', error);
            showActionError(action);
            return false;
        }
    };

    /**
     * Navigate to a different page
     */
    function executeNavigate(target) {
        if (!target) return false;

        const url = ACTION_REGISTRY.navigate[target];
        if (!url) {
            console.warn('Unknown navigation target:', target);
            return false;
        }

        // Show navigation feedback
        showActionFeedback(`Navigating to ${target}...`, 'info');

        // Navigate with smooth transition
        setTimeout(() => {
            window.location.href = url;
        }, 500);

        return true;
    }

    /**
     * Click an element
     */
    function executeClick(elementSelector) {
        if (!elementSelector) return false;

        // Check if element is in allowed list
        if (!ACTION_REGISTRY.click[elementSelector]) {
            console.warn('Element not in allowed list:', elementSelector);
            return false;
        }

        const element = document.querySelector(elementSelector);
        if (!element) {
            console.warn('Element not found:', elementSelector);
            showActionError('Element not found on this page');
            return false;
        }

        // Highlight element briefly before clicking
        highlightElement(element);

        setTimeout(() => {
            element.click();
            showActionFeedback(`Clicked ${elementSelector}`, 'success');
        }, 300);

        return true;
    }

    /**
     * Scroll to a section
     */
    function executeScroll(target) {
        if (!target) return false;

        const selector = ACTION_REGISTRY.scroll[target];
        if (!selector) {
            console.warn('Unknown scroll target:', target);
            return false;
        }

        const element = document.querySelector(selector);
        if (!element) {
            console.warn('Scroll target not found:', selector);
            showActionError('Section not found on this page');
            return false;
        }

        // Smooth scroll to element
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Briefly highlight the section
        highlightElement(element);
        showActionFeedback(`Scrolling to ${target}`, 'info');

        return true;
    }

    /**
     * Open a modal/form
     */
    function executeOpenModal(modalName) {
        if (!modalName) return false;

        const modalAction = ACTION_REGISTRY.open_modal[modalName];
        if (!modalAction) {
            console.warn('Unknown modal:', modalName);
            return false;
        }

        // Execute modal action
        if (typeof modalAction === 'function') {
            modalAction();
            showActionFeedback(`Opening ${modalName}`, 'success');
            return true;
        }

        return false;
    }

    /**
     * Highlight an element briefly
     */
    function highlightElement(element) {
        const originalOutline = element.style.outline;
        const originalTransition = element.style.transition;

        element.style.transition = 'outline 0.3s ease';
        element.style.outline = '3px solid #3b82f6';
        element.style.outlineOffset = '4px';

        setTimeout(() => {
            element.style.outline = originalOutline;
            element.style.transition = originalTransition;
        }, 1500);
    }

    /**
     * Show action feedback toast
     */
    function showActionFeedback(message, type = 'info') {
        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'chatbot-action-toast';
        toast.style.cssText = `
            position: fixed;
            top: 90px;
            right: 25px;
            padding: 12px 20px;
            background: ${type === 'success' ? 'rgba(34, 197, 94, 0.95)' :
                type === 'error' ? 'rgba(239, 68, 68, 0.95)' :
                    'rgba(59, 130, 246, 0.95)'};
            color: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            font-size: 14px;
            font-weight: 500;
            animation: slideInRight 0.3s ease;
        `;
        toast.textContent = message;

        document.body.appendChild(toast);

        // Remove after 3 seconds
        setTimeout(() => {
            toast.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    /**
     * Show action error
     */
    function showActionError(message) {
        showActionFeedback(`❌ ${message}`, 'error');
    }

    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideInRight {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        @keyframes slideOutRight {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(400px);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);

    console.log('Chatbot Action Executor initialized ✓');
})();
