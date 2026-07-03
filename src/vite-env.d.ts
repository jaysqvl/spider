/// <reference types="vite/client" />

declare module "*.css";

interface ImportMetaEnv {
  readonly VITE_SPIDER_DEV_TOOLS?: string;
}
