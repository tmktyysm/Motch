-- Add address column to users table
ALTER TABLE users ADD COLUMN address TEXT;

-- Create index for address-based searches (optional but useful)
CREATE INDEX IF NOT EXISTS idx_users_address ON users(address);
