import type { ApprovalDetails } from './messages.js';

const id = new URLSearchParams(location.search).get('id');
const origin = document.querySelector<HTMLElement>('#origin')!;
const title = document.querySelector<HTMLElement>('#title')!;
const details = document.querySelector<HTMLElement>('#details')!;
const approve = document.querySelector<HTMLButtonElement>('#approve')!;
const reject = document.querySelector<HTMLButtonElement>('#reject')!;

if (!id) {
    showError('Missing approval request');
} else {
    chrome.runtime.sendMessage({ type: 'approval:get', id }).then((request: ApprovalDetails | null) => {
        if (!request) return showError('This request expired');
        title.textContent = request.title;
        origin.textContent = request.origin;
        request.lines.forEach((line) => {
            const item = document.createElement('li');
            item.textContent = line;
            details.appendChild(item);
        });
        approve.disabled = false;
        reject.disabled = false;
    });
}

approve.addEventListener('click', () => resolve(true));
reject.addEventListener('click', () => resolve(false));

async function resolve(approved: boolean) {
    await chrome.runtime.sendMessage({ type: 'approval:resolve', id, approved });
    window.close();
}

function showError(message: string) {
    title.textContent = message;
    origin.textContent = '';
    approve.hidden = true;
    reject.textContent = 'Close';
    reject.disabled = false;
}
