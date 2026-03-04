'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { handleUserRedirect } from '@/lib/auth-utils';

export default function AuthCallbackPage() {
    const router = useRouter();
    const [errorMsg, setErrorMsg] = useState('');

    useEffect(() => {
        // Check for an error from the OAuth provider first
        const params = new URLSearchParams(window.location.search);
        const oauthError = params.get('error');
        const oauthErrorDesc = params.get('error_description');
        if (oauthError) {
            setErrorMsg(oauthErrorDesc ?? oauthError);
            return;
        }

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (event, session) => {
                if (event === 'SIGNED_IN' && session?.user?.email) {
                    handleUserRedirect(session.user.email, router);
                }
            }
        );

        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user?.email) {
                handleUserRedirect(session.user.email, router);
            }
        });

        return () => subscription.unsubscribe();
    }, [router]);

    if (errorMsg) {
        return (
            <div className="auth-loading-screen">
                <p style={{ color: 'red', marginBottom: '1rem' }}>
                    Authentication failed: {errorMsg}
                </p>
                <a href="/" style={{ color: '#6366f1', textDecoration: 'underline' }}>
                    ← Back to login
                </a>
            </div>
        );
    }

    return (
        <div className="auth-loading-screen">
            <div className="auth-loading-spinner" />
            <p>Completing sign in…</p>
        </div>
    );
}
