import { Context, Next } from 'hono';

export const authMiddleware = async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = authHeader.split(' ')[1];

    // Very simplistic check; in a real app, verify the JWT here
    if (token !== 'mock-admin-token-123') {
        return c.json({ error: 'Invalid token' }, 401);
    }

    await next();
};
