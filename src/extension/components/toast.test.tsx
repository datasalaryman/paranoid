import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastNotification } from './toast';

test('keeps a live region mounted above modals for clipboard and other notifications', () => {
    const markup = renderToStaticMarkup(<ToastNotification />);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain('z-[100]');
});
