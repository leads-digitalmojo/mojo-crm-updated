import { Task } from '../types';

export const canToggleTaskCompletion = (
    task: Task,
    userId?: string,
    userEmail?: string
) => {
    return true; // Allow any logged-in user to complete tasks
};

export const canEditTask = canToggleTaskCompletion;
export const canDeleteTask = canToggleTaskCompletion;
