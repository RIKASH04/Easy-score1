import { supabase, SUPER_ADMIN_EMAIL } from './supabase';
import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';

export const getRedirectPath = async (email: string): Promise<string> => {
    if (email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
        return '/super-admin';
    }

    // Check if email is an Institution Admin (compare lowercase for casing)
    const emailLower = email.toLowerCase();
    const { data: inst } = await supabase
        .from('institutions')
        .select('id, is_active')
        .eq('admin_email', emailLower)
        .maybeSingle();

    if (inst) {
        if (inst.is_active) {
            return '/admin';
        } else {
            return '/deactivated';
        }
    }

    // Default to Judge
    return '/judge';
};

export const handleUserRedirect = async (email: string, router: AppRouterInstance, setFormError?: (err: string) => void) => {
    const path = await getRedirectPath(email);
    if (path === '/deactivated') {
        if (setFormError) setFormError('Your institution account is deactivated. Contact Super Admin.');
        await supabase.auth.signOut();
    } else {
        router.replace(path);
    }
};
