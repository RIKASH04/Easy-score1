'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

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

        // The Supabase browser client (with flowType:'pkce' + detectSessionInUrl:true)
        // automatically detects the ?code= parameter, reads the code_verifier from
        // localStorage, and exchanges it for a session.
        // We just need to wait for the SIGNED_IN event and redirect.
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (event, session) => {
                if (event === 'SIGNED_IN' && session?.user) {
                    // Google OAuth users always go to Judge dashboard
                    router.replace('/judge');
                }
            }
        );

        // Also handle the case where the session is set before the listener fires
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                // Google OAuth users always go to Judge dashboard
                router.replace('/judge');
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
