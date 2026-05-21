export interface SupportInboxConversation {
  id: string;
  user_id?: string;
  user_first_name?: string;
  user_last_name?: string;
  user_email?: string;
  priority: "urgent" | "high" | "low" | "normal";
  last_message_sender_type: string;
  last_message_at: string;
  last_message_body: string;
}

export interface SupportMessage {
  id: string;
  sender_type: string;
  body: string;
  created_at: string;
}

export interface SupportUserContext {
  [key: string]: any;
}
