export const CHAT_FILE_MAX_BYTES = 20 * 1024 * 1024;
export type SavedChatFile = { id: string; name: string; size: number; mime: string; createdAt: string; origin: "upload" | "output" };
