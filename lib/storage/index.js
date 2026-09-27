import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/config";
import { randomToken } from "@/lib/security/crypto";
import { AppError } from "@/lib/api/errors";

class LocalStorage {
    root = path.resolve(process.cwd(), "storage");

    resolve(key) {
        const full = path.resolve(this.root, key);
        if (!full.startsWith(this.root + path.sep))
            throw new AppError("VALIDATION_ERROR", "Invalid storage key");
        return full;
    }

    async put(key, data) {
        const full = this.resolve(key);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, data);
    }

    async get(key) {
        return readFile(this.resolve(key));
    }
}

class SupabaseStorage {
    base = `${env().SUPABASE_URL?.replace(/\/$/, "")}/storage/v1/object/${env().SUPABASE_STORAGE_BUCKET}`;
    headers = { Authorization: `Bearer ${env().SUPABASE_SERVICE_ROLE_KEY}` };

    async put(key, data, contentType) {
        const res = await fetch(`${this.base}/${key}`, {
            method: "POST",
            headers: { ...this.headers, "Content-Type": contentType, "x-upsert": "false" },
            body: new Uint8Array(data),
        });
        if (!res.ok)
            throw new Error(`Supabase storage upload failed (${res.status})`);
    }

    async get(key) {
        const res = await fetch(`${this.base}/${key}`, { headers: this.headers });
        if (!res.ok)
            throw new AppError("NOT_FOUND");
        return Buffer.from(await res.arrayBuffer());
    }
}

let provider = null;
export function storage() {
    if (!provider) {
        if (env().STORAGE_PROVIDER === "supabase") {
            if (!env().SUPABASE_URL || !env().SUPABASE_SERVICE_ROLE_KEY)
                throw new Error("Supabase storage is not configured");
            provider = new SupabaseStorage();
        }
        else {
            provider = new LocalStorage();
        }
    }
    return provider;
}

export const ALLOWED_UPLOAD_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
};
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Validates type (by magic bytes, not just the header) and size, then stores. */
export async function storeUpload(prefix, file) {
    if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
        throw new AppError("VALIDATION_ERROR", "Files must be between 1 byte and 8 MB.");
    }
    const ext = ALLOWED_UPLOAD_TYPES[file.type];
    if (!ext)
        throw new AppError("VALIDATION_ERROR", "Only JPG, PNG, WEBP or PDF files are accepted.");
    const buf = Buffer.from(await file.arrayBuffer());
    if (!matchesMagic(buf, file.type))
        throw new AppError("VALIDATION_ERROR", "The file content does not match its type.");
    const key = `${prefix}/${Date.now()}-${randomToken(8)}.${ext}`;
    await storage().put(key, buf, file.type);
    return { key, name: file.name.slice(0, 200), size: file.size, type: file.type };
}

function matchesMagic(buf, type) {
    const hex = buf.subarray(0, 12).toString("hex");
    switch (type) {
        case "image/jpeg":
            return hex.startsWith("ffd8ff");
        case "image/png":
            return hex.startsWith("89504e470d0a1a0a");
        case "image/webp":
            return hex.startsWith("52494646") && buf.subarray(8, 12).toString() === "WEBP";
        case "application/pdf":
            return buf.subarray(0, 5).toString() === "%PDF-";
        default:
            return false;
    }
}

