-- Add role column to users table
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user'));

-- Create index for role-based queries
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Update existing users: set first user as admin, others as regular users
UPDATE users SET role = 'admin' WHERE id = 1;
