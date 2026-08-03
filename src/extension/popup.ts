chrome.runtime.sendMessage({ type: 'wallet:status' }).then(({ address, cluster }) => {
    document.querySelector<HTMLElement>('#address')!.textContent = address;
    document.querySelector<HTMLElement>('#cluster')!.textContent = cluster;
});
