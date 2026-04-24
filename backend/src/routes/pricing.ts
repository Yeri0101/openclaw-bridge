import { Hono } from 'hono';
import { supabase } from '../db';
import { authMiddleware } from '../middleware/auth';

const pricing = new Hono();

pricing.use('*', authMiddleware);

pricing.get('/', async (c) => {
    const { data, error } = await supabase
        .from('model_pricing')
        .select('*')
        .order('provider', { ascending: true })
        .order('model_name', { ascending: true });

    if (error) return c.json({ error: error.message }, 500);
    return c.json(data);
});

pricing.post('/', async (c) => {
    const body = await c.req.json();
    const provider = typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim() : '*';
    const model_name = typeof body.model_name === 'string' ? body.model_name.trim() : '';
    const input_price_per_1m = Number(body.input_price_per_1m ?? 0);
    const output_price_per_1m = Number(body.output_price_per_1m ?? 0);
    const is_active = body.is_active !== false;

    if (!model_name) return c.json({ error: 'model_name is required' }, 400);
    if (input_price_per_1m < 0 || output_price_per_1m < 0) {
        return c.json({ error: 'Prices must be >= 0' }, 400);
    }

    const payload = {
        provider,
        model_name,
        input_price_per_1m,
        output_price_per_1m,
        is_active,
        updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
        .from('model_pricing')
        .upsert(payload, { onConflict: 'provider,model_name' })
        .select()
        .single();

    if (error) return c.json({ error: error.message }, 500);
    return c.json(data, 201);
});

pricing.patch('/:id', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json();
    const updates: Record<string, any> = {
        updated_at: new Date().toISOString(),
    };

    if (body.provider !== undefined) updates.provider = typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim() : '*';
    if (body.model_name !== undefined) updates.model_name = body.model_name;
    if (body.input_price_per_1m !== undefined) updates.input_price_per_1m = Number(body.input_price_per_1m);
    if (body.output_price_per_1m !== undefined) updates.output_price_per_1m = Number(body.output_price_per_1m);
    if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);

    const { data, error } = await supabase
        .from('model_pricing')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) return c.json({ error: error.message }, 500);
    return c.json(data);
});

pricing.delete('/:id', async (c) => {
    const { id } = c.req.param();
    const { error } = await supabase.from('model_pricing').delete().eq('id', id);
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ success: true });
});

export default pricing;
