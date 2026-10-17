import { AuthMethod, ParsedUsername } from '../types';
/**
 * Parse a username to detect its format and extract domain/user components.
 *
 * Supported formats:
 * - Local: "Administrator" -> { user: "Administrator", domain: "", format: "local" }
 * - Domain: "DOMAIN\user" -> { user: "user", domain: "DOMAIN", format: "domain" }
 * - UPN: "user@domain.com" -> { user: "user", domain: "domain.com", format: "upn" }
 */
export declare function parseUsername(username: string): ParsedUsername;
/**
 * Detect the appropriate authentication method based on username format.
 */
export declare function detectAuthMethod(username: string): AuthMethod;
/**
 * Create a Basic authentication header string.
 */
export declare function createBasicAuth(username: string, password: string): string;
