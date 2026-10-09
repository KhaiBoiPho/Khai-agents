-- What a provider reported a response actually cost, in USD (OpenRouter
-- returns it in ``usage.cost``). NULL when the provider reports no cost;
-- usage reporting then falls back to catalog list prices.

ALTER TABLE usage_records
    ADD COLUMN cost_usd double precision CHECK (cost_usd IS NULL OR cost_usd >= 0);
