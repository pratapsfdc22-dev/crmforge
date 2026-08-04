/**
 * Authentication middleware and utilities
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from './supabase.js';

// Extend Fastify request type
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email?: string;
      role?: string;
    };
  }
}

// Extract token from Authorization header
function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return null;
  }

  // Bearer <token>
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

// Middleware: require authentication
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const token = extractToken(request);

  if (!token) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Missing authentication token'
    });
  }

  const user = await verifyToken(token);

  if (!user) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid or expired token'
    });
  }

  // Attach user to request
  request.user = {
    id: user.id,
    email: user.email,
    role: user.role
  };
}

// Middleware: optional authentication (doesn't fail if missing)
export async function optionalAuth(request: FastifyRequest) {
  const token = extractToken(request);

  if (token) {
    const user = await verifyToken(token);
    if (user) {
      request.user = {
        id: user.id,
        email: user.email,
        role: user.role
      };
    }
  }
}

// Authenticate request and return user context
export async function authenticateRequest(request: FastifyRequest): Promise<{
  userId: string;
  orgId: string;
  tier: string;
}> {
  const token = extractToken(request);

  if (!token) {
    throw new Error('Unauthorized: Missing authentication token');
  }

  const user = await verifyToken(token);

  if (!user) {
    throw new Error('Unauthorized: Invalid or expired token');
  }

  // In a real implementation, would fetch orgId and tier from database
  // For now, use placeholder values
  return {
    userId: user.id,
    orgId: 'org-placeholder', // Would be fetched from user's org membership
    tier: 'professional' // Would be fetched from org subscription
  };
}
