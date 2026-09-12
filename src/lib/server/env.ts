import { z } from "zod";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export const databaseConfig = () => ({
  uri: required("NEO4J_URI"),
  username: required("NEO4J_USERNAME"),
  password: required("NEO4J_PASSWORD"),
  database: process.env.NEO4J_DATABASE?.trim() || "neo4j",
});

export const deepSeekConfig = () => ({
  apiKey: required("DEEPSEEK_API_KEY"),
  baseURL: process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
  model: required("DEEPSEEK_MODEL"),
});

export const elevenLabsConfig = () => ({
  apiKey: required("ELEVENLABS_API_KEY"),
  voiceId: required("ELEVENLABS_VOICE_ID"),
  model: process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5",
});

export const recallConfig = () => ({
  apiKey: required("RECALL_API_KEY"),
  region: z.enum(["us-west-2", "us-east-1", "eu-central-1", "ap-northeast-1"]).parse(required("RECALL_REGION")),
  verificationSecret: required("RECALL_WORKSPACE_VERIFICATION_SECRET"),
  statusSecret: process.env.RECALL_STATUS_WEBHOOK_SECRET?.trim() || required("RECALL_WORKSPACE_VERIFICATION_SECRET"),
  appBaseUrl: z.string().url().parse(required("APP_BASE_URL")).replace(/\/$/, ""),
});

export const isDemoMode = () => process.env.DEMO_MODE === "true";
