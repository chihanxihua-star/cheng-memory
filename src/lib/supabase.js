import { createClient } from '@supabase/supabase-js'

const url = "https://fgfyvyztjyqvxijfppgm.supabase.co"
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnZnl2eXp0anlxdnhpamZwcGdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4ODMxNzMsImV4cCI6MjA5MDQ1OTE3M30.APTLMLcdY5lsxxXjHeZ3WQvFbYUINjsCUZImECI-pVk"

export const supabase = createClient(url, key)
