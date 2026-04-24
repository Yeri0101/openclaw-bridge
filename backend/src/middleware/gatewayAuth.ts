import { Context, Next } from 'hono';
import { supabase } from '../db';

export const gatewayAuth = async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: { message: "Invalid Authorization header", type: "invalid_request_error" } }, 401);
    }

    const token = authHeader.split(' ')[1];

    // Lookup the token in gateway_keys
    const { data: keyData, error } = await supabase
        .from('gateway_keys')
        .select('*, gateway_key_models(upstream_key_id, model_name)')
        .eq('api_key', token)
        .single();

    if (error || !keyData) {
        return c.json({ error: { message: "Invalid API Key", type: "authentication_error" } }, 401);
    }

    // Bind the key data to context for the handler
    c.set('gatewayKey', keyData);

    await next();
};
