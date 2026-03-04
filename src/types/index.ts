export interface Institution {
    id: string;
    name: string;
    admin_email: string;
    is_active: boolean;
    created_at: string;
}

export interface Room {
    id: string;
    institution_id: string;
    secret_code: string;
    judge_count_required: 2 | 3;
    created_by: string;
    created_at: string;
}

export interface Judge {
    id: string;
    email: string;
    room_id: string;
    joined_at: string;
}

export interface Event {
    id: string;
    room_id: string;
    institution_id: string;
    event_name: string;
    category: string;
    participant_count: number;
    created_by: string;
    created_at: string;
}

export interface Score {
    id: string;
    event_id: string;
    institution_id: string;
    judge_email: string;
    participant_number: number;
    score: number;
    created_at: string;
}
