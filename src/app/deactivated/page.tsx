'use client';

import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';

export default function DeactivatedPage() {
    const router = useRouter();

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        router.replace('/');
    };

    return (
        <div className="auth-page-v2 flex items-center justify-center min-h-screen">
            <motion.div 
                className="card shadow-xl"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{ maxWidth: 450, textAlign: 'center', padding: 40 }}
            >
                <div style={{ fontSize: '4rem', marginBottom: 20 }}>🔒</div>
                <h1 className="text-2xl font-bold mb-4">Account Deactivated</h1>
                <p className="col-muted mb-8">
                    Your institution admin account has been deactivated by the Super Admin. 
                    Please contact rikashrikash04@gmail.com for more information.
                </p>
                <button 
                    onClick={handleSignOut}
                    className="btn btn-primary btn-full"
                >
                    Back to Login
                </button>
            </motion.div>
        </div>
    );
}
