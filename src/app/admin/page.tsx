'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, ADMIN_EMAIL } from '@/lib/supabase';
import type { Room, Judge, Event, Score } from '@/types';
import Footer from '@/components/Footer';

interface RoomWithDetails extends Room {
    judges: Judge[];
    events: EventWithScores[];
}
interface EventWithScores extends Event {
    scores: Score[];
}
interface Toast { id: number; msg: string; type: 'success' | 'error' | 'info'; }
let _tid = 0;

const fadeUp = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const } },
};
const stagger = {
    hidden: {}, show: { transition: { staggerChildren: 0.07 } },
};

export default function AdminPage() {
    const router = useRouter();
    const [authReady, setAuthReady] = useState(false);
    const [userEmail, setUserEmail] = useState('');
    const [rooms, setRooms] = useState<RoomWithDetails[]>([]);
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [newRoomJudgeCount, setNewRoomJudgeCount] = useState<2 | 3>(3);
    const [creating, setCreating] = useState(false);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [roomTab, setRoomTab] = useState<'overview' | 'scores'>('overview');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [confirmDeleteRoom, setConfirmDeleteRoom] = useState<string | null>(null);
    const [confirmRemoveJudge, setConfirmRemoveJudge] = useState<{ roomId: string; judgeId: string; email: string } | null>(null);
    const roomsRef = useRef<RoomWithDetails[]>([]);
    roomsRef.current = rooms;

    const showToast = useCallback((msg: string, type: Toast['type'] = 'info') => {
        const id = ++_tid;
        setToasts((p) => [...p, { id, msg, type }]);
        setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
    }, []);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user?.email === ADMIN_EMAIL) {
                // Supabase session exists for admin email — use it (JWT authorises DB calls)
                const provider = session.user.app_metadata?.provider;
                if (provider !== 'email') { router.replace('/judge'); return; }
                setUserEmail(session.user.email);
                setAuthReady(true);
                return;
            }
            // No Supabase session — check local sessionStorage flag (set at login)
            const localAdmin = typeof window !== 'undefined' &&
                sessionStorage.getItem('es-admin-auth') === 'true';
            if (localAdmin) {
                // Admin has local flag but no Supabase session yet
                // (e.g. email-confirmation still pending in Supabase)
                // DB writes will fail due to RLS; redirect to login to re-authenticate
                setUserEmail(ADMIN_EMAIL);
                setAuthReady(true);
                return;
            }
            // Neither session nor flag — not authenticated
            router.replace('/');
        });
    }, [router]);


    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const { data: rawRooms, error: rErr } = await supabase
                .from('rooms').select('*').order('created_at', { ascending: false });
            if (rErr) throw rErr;
            if (!rawRooms || rawRooms.length === 0) { setRooms([]); return; }

            const roomIds = (rawRooms as Room[]).map((r) => r.id);
            const [judgesRes, eventsRes] = await Promise.all([
                supabase.from('judges').select('*').in('room_id', roomIds),
                supabase.from('events').select('*').in('room_id', roomIds).order('created_at', { ascending: false }),
            ]);
            const allJudges = (judgesRes.data as Judge[]) || [];
            const allEvents = (eventsRes.data as Event[]) || [];

            let allScores: Score[] = [];
            if (allEvents.length > 0) {
                const eventIds = allEvents.map((e) => e.id);
                const { data: sd } = await supabase.from('scores').select('*').in('event_id', eventIds).order('created_at', { ascending: true });
                allScores = (sd as Score[]) || [];
            }

            setRooms((rawRooms as Room[]).map((room) => ({
                ...room,
                judges: allJudges.filter((j) => j.room_id === room.id),
                events: allEvents.filter((e) => e.room_id === room.id).map((ev) => ({
                    ...ev, scores: allScores.filter((s) => s.event_id === ev.id),
                })),
            })));
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load data.';
            if (message.includes('401') || message.includes('JWT')) {
                showToast('Session expired or missing keys. Please re-login.', 'error');
                router.replace('/');
            } else {
                showToast(message, 'error');
            }
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        if (!authReady) return;
        loadAll();
    }, [authReady, loadAll]);

    useEffect(() => {
        if (!authReady) return;
        const ch = supabase.channel('admin-rt')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'judges' }, loadAll)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, loadAll)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, loadAll)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, loadAll)
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [authReady, loadAll]);

    const generateCode = () => {
        const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        return Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join('');
    };

    const handleCreateRoom = async () => {
        setCreating(true);
        try {
            let code = '', attempts = 0;
            while (attempts < 10) {
                const c = generateCode();
                const { data } = await supabase.from('rooms').select('id').eq('secret_code', c).maybeSingle();
                if (!data) { code = c; break; }
                attempts++;
            }
            if (!code) throw new Error('Could not generate a unique code.');
            const { error } = await supabase.from('rooms').insert({
                secret_code: code, judge_count_required: newRoomJudgeCount, created_by: userEmail,
            });
            if (error) throw new Error(`DB error [${error.code}]: ${error.message}`);
            showToast(`✓ Room created! Code: ${code}`, 'success');
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : JSON.stringify(err), 'error');
        } finally {
            setCreating(false);
        }

    };

    const handleDeleteRoom = async (id: string) => {
        try {
            const { error } = await supabase.from('rooms').delete().eq('id', id);
            if (error) throw error;
            if (selectedRoomId === id) setSelectedRoomId(null);
            showToast('Room deleted successfully.', 'success');
        } catch (err) {
            console.error(err);
            showToast('Failed to delete room.', 'error');
        } finally {
            setConfirmDeleteRoom(null);
        }
    };

    const handleRemoveJudge = async (roomId: string, judgeId: string) => {
        try {
            const { error } = await supabase.from('judges').delete().eq('id', judgeId);
            if (error) throw error;
            showToast('Judge removed from room.', 'success');
        } catch (err) {
            console.error(err);
            showToast('Failed to remove judge.', 'error');
        } finally {
            setConfirmRemoveJudge(null);
        }
    };

    const copyCode = (code: string) => {
        navigator.clipboard.writeText(code);
        showToast(`"${code}" copied!`, 'info');
    };

    const handleSignOut = async () => {
        // Clear local admin session flag
        sessionStorage.removeItem('es-admin-auth');
        await supabase.auth.signOut();
        router.replace('/');
    };

    const selectRoom = (id: string | null) => {
        setSelectedRoomId(id);
        setRoomTab('overview');
        setSidebarOpen(false);
    };

    const totalJudges = rooms.reduce((s, r) => s + r.judges.length, 0);
    const totalEvents = rooms.reduce((s, r) => s + r.events.length, 0);
    const totalScores = rooms.reduce((s, r) => s + r.events.reduce((es, ev) => es + ev.scores.length, 0), 0);
    const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;
    const initials = userEmail.charAt(0).toUpperCase();

    if (!authReady || loading) {
        return (
            <div className="loading-screen">
                <div className="spinner" />
                <p>{!authReady ? 'Verifying access…' : 'Loading dashboard…'}</p>
            </div>
        );
    }

    return (
        <div className="page-layout">
            {/* Mobile overlay */}
            <AnimatePresence>
                {sidebarOpen && (
                    <motion.div
                        className="sidebar-overlay"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={() => setSidebarOpen(false)}
                    />
                )}
            </AnimatePresence>

            {/* ──── SIDEBAR ──── */}
            <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
                {/* Gradient header */}
                <div className="sidebar-header">
                    <div className="sidebar-logo-icon">⚡</div>
                    <div className="sidebar-logo-text">Easy<span>Score</span></div>
                </div>

                <nav className="sidebar-nav">
                    <div className="sidebar-section-title">Navigation</div>

                    <button id="sidebar-overview" className={`sidebar-item ${!selectedRoomId ? 'active' : ''}`}
                        onClick={() => selectRoom(null)}>
                        <span style={{ fontSize: '1rem' }}>🏠</span>
                        <span className="flex-1">Overview</span>
                    </button>

                    {rooms.length > 0 && (
                        <>
                            <div className="sidebar-section-title" style={{ marginTop: 16 }}>Rooms</div>
                            {rooms.map((room) => {
                                const full = room.judges.length >= room.judge_count_required;
                                return (
                                    <motion.button
                                        key={room.id}
                                        id={`sidebar-room-${room.id}`}
                                        className={`sidebar-item ${selectedRoomId === room.id ? 'active' : ''}`}
                                        onClick={() => selectRoom(room.id)}
                                        whileHover={{ x: 2 }}
                                        transition={{ duration: 0.15 }}
                                    >
                                        <span
                                            className="sidebar-item-dot"
                                            style={{ background: full ? 'var(--success)' : 'var(--warning)' }}
                                        />
                                        <span className="flex-1 truncate"
                                            style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.85rem' }}>
                                            {room.secret_code}
                                        </span>
                                        <span className="sidebar-count">
                                            {room.judges.length}/{room.judge_count_required}
                                        </span>
                                    </motion.button>
                                );
                            })}
                        </>
                    )}
                </nav>

                {/* Footer */}
                <div className="sidebar-footer">
                    <div className="sidebar-user">
                        <div className="sidebar-avatar">{initials}</div>
                        <div className="sidebar-email">{userEmail}</div>
                    </div>
                    <motion.button id="btn-signout" onClick={handleSignOut}
                        className="btn btn-secondary btn-sm btn-full" whileTap={{ scale: 0.97 }}>
                        Sign Out
                    </motion.button>
                </div>
            </aside>

            {/* ──── MAIN ──── */}
            <main className="main-content" style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Header */}
                <header className="main-header">
                    <div className="flex items-c gap-3">
                        <button className="hamburger" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
                            <span /><span /><span />
                        </button>
                        <div>
                            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                                {selectedRoom ? selectedRoom.secret_code : 'Admin Dashboard'}
                            </h3>
                            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                {selectedRoom ? `${selectedRoom.judges.length} judge(s) joined` : 'Manage rooms and monitor scoring'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-c gap-3">
                        <span className="live-badge">LIVE</span>
                        <span className="badge badge-yellow hide-sm">Admin</span>
                    </div>
                </header>

                {/* Body */}
                <div className="main-body">
                    <AnimatePresence mode="wait">
                        {/* ── OVERVIEW ── */}
                        {!selectedRoom && (
                            <motion.div key="overview" variants={stagger} initial="hidden" animate="show">
                                {/* Stats */}
                                <motion.div
                                    className="grid-4"
                                    variants={stagger}
                                    style={{ marginBottom: 28 }}
                                >
                                    {[
                                        { icon: '🏠', label: 'Total Rooms', value: rooms.length, color: '#EEF2FF', ico: '#6366F1' },
                                        { icon: '⚖️', label: 'Total Judges', value: totalJudges, color: '#ECFDF5', ico: '#059669' },
                                        { icon: '📋', label: 'Total Events', value: totalEvents, color: '#FFF7ED', ico: '#F97316' },
                                        { icon: '✅', label: 'Score Entries', value: totalScores, color: '#F0FDF4', ico: '#10B981' },
                                    ].map((s) => (
                                        <motion.div key={s.label} className="stat-card" variants={fadeUp}>
                                            <div className="stat-icon" style={{ background: s.color }}>
                                                <span>{s.icon}</span>
                                            </div>
                                            <div className="stat-value">{s.value}</div>
                                            <div className="stat-label">{s.label}</div>
                                        </motion.div>
                                    ))}
                                </motion.div>

                                {/* Create room */}
                                <motion.div className="card" variants={fadeUp} style={{ marginBottom: 24 }}>
                                    <div className="card-header">
                                        <div>
                                            <h3>Create New Room</h3>
                                            <p className="text-xs col-muted mt-1">A unique 6-character code is auto-generated for judges to join.</p>
                                        </div>
                                    </div>
                                    <div className="card-body">
                                        <div className="flex items-c gap-4" style={{ flexWrap: 'wrap' }}>
                                            <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
                                                <label className="form-label">Judges Required</label>
                                                <select id="select-judge-count" className="select"
                                                    value={newRoomJudgeCount}
                                                    onChange={(e) => setNewRoomJudgeCount(Number(e.target.value) as 2 | 3)}>
                                                    <option value={2}>2 Judges</option>
                                                    <option value={3}>3 Judges</option>
                                                </select>
                                            </div>
                                            <motion.button
                                                id="btn-create-room"
                                                onClick={handleCreateRoom}
                                                disabled={creating}
                                                className="btn btn-primary"
                                                style={{ alignSelf: 'flex-end', height: 40 }}
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.97 }}
                                            >
                                                {creating
                                                    ? <><div className="spinner spinner-sm spinner-white" /> Creating…</>
                                                    : '+ Create Room'}
                                            </motion.button>
                                        </div>
                                    </div>
                                </motion.div>

                                {/* Rooms table */}
                                <motion.div className="card" variants={fadeUp}>
                                    <div className="card-header">
                                        <h3>All Rooms</h3>
                                        <span className="badge badge-gray">{rooms.length}</span>
                                    </div>
                                    <div className="table-wrap">
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th>Code</th>
                                                    <th>Judges</th>
                                                    <th>Events</th>
                                                    <th>Scores</th>
                                                    <th>Created</th>
                                                    <th></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rooms.length === 0 ? (
                                                    <tr><td colSpan={6}>
                                                        <div className="empty-state">
                                                            <div className="empty-state-icon">🏠</div>
                                                            <h4>No rooms yet</h4>
                                                            <p>Create your first room above to get started.</p>
                                                        </div>
                                                    </td></tr>
                                                ) : rooms.map((room) => (
                                                    <tr key={room.id}>
                                                        <td>
                                                            <button className="room-code" onClick={() => copyCode(room.secret_code)} title="Click to copy">
                                                                {room.secret_code} <span style={{ fontSize: 10 }}>⎘</span>
                                                            </button>
                                                        </td>
                                                        <td>
                                                            <strong>{room.judges.length}</strong>
                                                            <span className="col-muted"> / {room.judge_count_required}</span>
                                                            {room.judges.length >= room.judge_count_required &&
                                                                <span className="badge badge-green" style={{ marginLeft: 6 }}>Full</span>}
                                                        </td>
                                                        <td><strong>{room.events.length}</strong></td>
                                                        <td><strong>{room.events.reduce((s, e) => s + e.scores.length, 0)}</strong></td>
                                                        <td className="col-muted">{new Date(room.created_at).toLocaleDateString()}</td>
                                                        <td>
                                                            <div className="flex gap-2">
                                                                <button className="btn btn-ghost btn-sm"
                                                                    onClick={() => selectRoom(room.id)}>View →</button>
                                                                <button className="btn btn-ghost btn-sm text-danger"
                                                                    onClick={() => setConfirmDeleteRoom(room.id)}
                                                                    title="Delete Room">
                                                                    🗑️
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </motion.div>
                            </motion.div>
                        )}

                        {/* ── ROOM DETAIL ── */}
                        {selectedRoom && (
                            <motion.div key={selectedRoom.id}
                                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -16 }}
                                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                            >
                                {/* Room header card */}
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                                    gap: 12, marginBottom: 20,
                                }}>
                                    {[
                                        { label: 'Room Code', value: <button className="room-code" onClick={() => copyCode(selectedRoom.secret_code)}>{selectedRoom.secret_code} ⎘</button> },
                                        { label: 'Judges Joined', value: <strong style={{ fontSize: '1.3rem' }}>{selectedRoom.judges.length} / {selectedRoom.judge_count_required}</strong> },
                                        { label: 'Events', value: <strong style={{ fontSize: '1.3rem' }}>{selectedRoom.events.length}</strong> },
                                        { label: 'Score Entries', value: <strong style={{ fontSize: '1.3rem' }}>{selectedRoom.events.reduce((s, e) => s + e.scores.length, 0)}</strong> },
                                    ].map((item) => (
                                        <div key={item.label} style={{
                                            background: 'white', border: '1px solid var(--border)',
                                            borderRadius: 'var(--r-md)', padding: '14px 16px',
                                            boxShadow: 'var(--shadow-xs)',
                                        }}>
                                            <div className="text-xs col-muted font-600" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                                                {item.label}
                                            </div>
                                            <div>{item.value}</div>
                                        </div>
                                    ))}
                                </div>

                                {/* Tab bar */}
                                <div style={{
                                    display: 'flex', gap: 4, background: 'var(--bg-muted)',
                                    borderRadius: 'var(--r-sm)', padding: 4, marginBottom: 20,
                                    width: 'fit-content',
                                }}>
                                    {(['overview', 'scores'] as const).map((t) => (
                                        <button key={t}
                                            className={`btn btn-sm ${roomTab === t ? 'btn-primary' : 'btn-ghost'}`}
                                            onClick={() => setRoomTab(t)}>
                                            {t === 'overview' ? '📋 Overview' : '📊 Live Scores'}
                                        </button>
                                    ))}
                                </div>

                                <AnimatePresence mode="wait">
                                    {/* Overview tab */}
                                    {roomTab === 'overview' && (
                                        <motion.div key="overview-tab"
                                            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -10 }}
                                            transition={{ duration: 0.25 }}
                                            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                                        >
                                            {/* Judges */}
                                            <div className="card">
                                                <div className="card-header">
                                                    <h3>Judges in Room</h3>
                                                    <span className="badge badge-gray">{selectedRoom.judges.length}</span>
                                                </div>
                                                {selectedRoom.judges.length === 0 ? (
                                                    <div className="card-body">
                                                        <div className="empty-state" style={{ padding: '28px 0' }}>
                                                            <p>No judges have joined yet. Share the room code.</p>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="table-wrap">
                                                        <table className="table">
                                                            <thead><tr><th>#</th><th>Email</th><th>Joined</th><th>Actions</th></tr></thead>
                                                            <tbody>
                                                                {selectedRoom.judges.map((j, i) => (
                                                                    <tr key={j.id}>
                                                                        <td><strong>{i + 1}</strong></td>
                                                                        <td><strong>{j.email}</strong></td>
                                                                        <td className="col-muted">{new Date(j.joined_at).toLocaleString()}</td>
                                                                        <td>
                                                                            <button
                                                                                className="btn btn-ghost btn-sm text-danger"
                                                                                onClick={() => setConfirmRemoveJudge({ roomId: selectedRoom.id, judgeId: j.id, email: j.email })}
                                                                            >
                                                                                Remove
                                                                            </button>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Events */}
                                            <div className="card">
                                                <div className="card-header">
                                                    <h3>Events</h3>
                                                    <span className="badge badge-gray">{selectedRoom.events.length}</span>
                                                </div>
                                                {selectedRoom.events.length === 0 ? (
                                                    <div className="card-body">
                                                        <div className="empty-state" style={{ padding: '28px 0' }}>
                                                            <p>No events yet. Judges create events after joining.</p>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="table-wrap">
                                                        <table className="table">
                                                            <thead><tr><th>Event</th><th>Participants</th><th>Score Entries</th><th>Created By</th><th>Date</th></tr></thead>
                                                            <tbody>
                                                                {selectedRoom.events.map((ev) => (
                                                                    <tr key={ev.id}>
                                                                        <td>
                                                                            <strong style={{ display: 'block' }}>{ev.event_name}</strong>
                                                                            {ev.category && <span className="badge badge-gray" style={{ marginTop: 4, display: 'inline-block', padding: '2px 6px', fontSize: '0.7rem' }}>{ev.category}</span>}
                                                                        </td>
                                                                        <td>{ev.participant_count}</td>
                                                                        <td>
                                                                            {ev.scores.length}
                                                                            {ev.scores.length > 0 && <span className="badge badge-green" style={{ marginLeft: 6 }}>Live</span>}
                                                                        </td>
                                                                        <td className="col-muted text-xs">{ev.created_by}</td>
                                                                        <td className="col-muted">{new Date(ev.created_at).toLocaleDateString()}</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>
                                        </motion.div>
                                    )}

                                    {/* Live Scores tab */}
                                    {roomTab === 'scores' && (
                                        <motion.div key="scores-tab"
                                            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -10 }}
                                            transition={{ duration: 0.25 }}
                                        >
                                            {selectedRoom.events.length === 0 ? (
                                                <div className="card">
                                                    <div className="card-body">
                                                        <div className="empty-state">
                                                            <div className="empty-state-icon">📊</div>
                                                            <h4>No events yet</h4>
                                                            <p>Judges must create events before scores appear here.</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                                    {selectedRoom.events.map((ev) => (
                                                        <EventScoreCard key={ev.id} event={ev} room={selectedRoom} />
                                                    ))}
                                                </div>
                                            )}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <Footer />
            </main>

            {/* Toasts */}
            <div className="toast-container">
                <AnimatePresence>
                    {toasts.map((t) => (
                        <motion.div key={t.id} className={`toast toast-${t.type}`}
                            initial={{ opacity: 0, x: 32, scale: 0.9 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, x: 32, scale: 0.9 }}
                            transition={{ duration: 0.3 }}>
                            <span className="toast-icon">
                                {t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : 'ℹ️'}
                            </span>
                            {t.msg}
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            {/* Confirmation Modals */}
            <AnimatePresence>
                {confirmDeleteRoom && (
                    <div className="sidebar-overlay" style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                        <motion.div 
                            className="card" 
                            style={{ maxWidth: 400, width: '100%' }}
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                        >
                            <div className="card-header">
                                <h3>Delete Room?</h3>
                            </div>
                            <div className="card-body">
                                <p style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>
                                    Are you sure you want to delete this room? This action cannot be undone and will remove all related judges, events, and scores.
                                </p>
                                <div className="flex gap-3 mt-4">
                                    <button className="btn btn-secondary flex-1" onClick={() => setConfirmDeleteRoom(null)}>Cancel</button>
                                    <button className="btn btn-primary flex-1 bg-danger" onClick={() => handleDeleteRoom(confirmDeleteRoom)}>Delete</button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}

                {confirmRemoveJudge && (
                    <div className="sidebar-overlay" style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                        <motion.div 
                            className="card" 
                            style={{ maxWidth: 400, width: '100%' }}
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                        >
                            <div className="card-header">
                                <h3>Remove Judge?</h3>
                            </div>
                            <div className="card-body">
                                <p style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>
                                    Are you sure you want to remove <strong>{confirmRemoveJudge.email}</strong> from this room? This will not delete their account.
                                </p>
                                <div className="flex gap-3 mt-4">
                                    <button className="btn btn-secondary flex-1" onClick={() => setConfirmRemoveJudge(null)}>Cancel</button>
                                    <button className="btn btn-primary flex-1 bg-danger" onClick={() => handleRemoveJudge(confirmRemoveJudge.roomId, confirmRemoveJudge.judgeId)}>Remove</button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}

/* ── Event Score Card ── */
function EventScoreCard({ event, room }: { event: EventWithScores; room: RoomWithDetails }) {
    const nums = Array.from({ length: event.participant_count }, (_, i) => i + 1);
    const judgeEmails = [...new Set(event.scores.map((s) => s.judge_email))];

    const results = nums.map((num) => {
        const ps = event.scores.filter((s) => s.participant_number === num);
        const total = ps.reduce((sum, s) => sum + s.score, 0);
        return { num, ps, total, avg: ps.length > 0 ? (total / ps.length).toFixed(1) : '—' };
    }).sort((a, b) => b.total - a.total);

    const maxScore = room.judge_count_required * 100;

    return (
        <motion.div className="card"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}>
            <div className="card-header">
                <div>
                    <h3 style={{ marginBottom: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                        {event.event_name}
                        {event.category && <span className="badge badge-gray" style={{ fontSize: '0.7rem', padding: '2px 6px' }}>{event.category}</span>}
                    </h3>
                    <p className="text-xs col-muted">
                        {event.participant_count} participants · {event.scores.length} score entries · by {event.created_by}
                    </p>
                </div>
                <span className="live-badge">LIVE</span>
            </div>

            {event.scores.length === 0 ? (
                <div className="card-body">
                    <div className="empty-state" style={{ padding: '20px 0' }}>
                        <p>No scores submitted yet.</p>
                    </div>
                </div>
            ) : (
                <div className="table-wrap">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Rank</th>
                                <th>Participant</th>
                                {judgeEmails.map((e) => (
                                    <th key={e} title={e}>⚖️ {e.split('@')[0]}</th>
                                ))}
                                <th>Total</th>
                                <th>Score %</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.map((row, idx) => {
                                const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1;
                                const pct = Math.round((row.total / maxScore) * 100);
                                return (
                                    <tr key={row.num}>
                                        <td><strong>{medal}</strong></td>
                                        <td><strong>Participant {row.num}</strong></td>
                                        {judgeEmails.map((em) => {
                                            const sc = row.ps.find((s) => s.judge_email === em);
                                            return (
                                                <td key={em}>
                                                    {sc !== undefined ? (
                                                        <span style={{
                                                            fontWeight: 700,
                                                            color: sc.score >= 80 ? 'var(--success)' : sc.score >= 50 ? 'var(--text-primary)' : 'var(--danger)',
                                                        }}>{sc.score}</span>
                                                    ) : <span className="col-muted">—</span>}
                                                </td>
                                            );
                                        })}
                                        <td>
                                            <strong style={{ color: 'var(--primary)', fontSize: '1rem' }}>
                                                {row.ps.length > 0 ? row.total : '—'}
                                            </strong>
                                        </td>
                                        <td>
                                            {row.ps.length > 0 ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 80 }}>
                                                    <div className="progress-track" style={{ flex: 1 }}>
                                                        <div className={`progress-fill ${idx === 0 ? 'progress-gold' : 'progress-primary'}`}
                                                            style={{ width: `${pct}%` }} />
                                                    </div>
                                                    <span className="text-xs font-700 col-sec">{pct}%</span>
                                                </div>
                                            ) : <span className="col-muted">—</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {event.scores.length > 0 && (
                <div className="card-footer">
                    Last updated: {new Date(event.scores[event.scores.length - 1]?.created_at).toLocaleString()}
                </div>
            )}
        </motion.div>
    );
}
