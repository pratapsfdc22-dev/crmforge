/**
 * Authentication routes
 */

import type { FastifyInstance } from 'fastify';
import type { Database } from '@forgesf/db/types';
import { supabaseAdmin } from '../lib/supabase.js';
import { z } from 'zod';

type Organization = Database['public']['Tables']['organizations']['Row'];
type OrgMember = Database['public']['Tables']['org_members']['Row'];

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  organizationName: z.string().min(1)
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function authRoutes(fastify: FastifyInstance) {
  // Sign up
  fastify.post('/auth/signup', async (request, reply) => {
    const body = SignupSchema.parse(request.body);

    const { data: authData, error: authError} =
      await supabaseAdmin.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true
      });

    if (authError || !authData.user) {
      return reply.status(400).send({
        error: 'SignupFailed',
        message: authError?.message || 'Failed to create user'
      });
    }

    const orgSlug = body.organizationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .insert({
        name: body.organizationName,
        slug: orgSlug,
        tier: 'trial',
        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single() as { data: Organization | null; error: any };

    if (orgError || !org) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return reply.status(400).send({
        error: 'SignupFailed',
        message: orgError?.message || 'Failed to create organization'
      });
    }

    const { error: memberError } = await supabaseAdmin
      .from('org_members')
      .insert({
        org_id: org.id,
        user_id: authData.user.id,
        role: 'owner'
      });

    if (memberError) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      await supabaseAdmin.from('organizations').delete().eq('id', org.id);
      return reply.status(400).send({
        error: 'SignupFailed',
        message: 'Failed to add user to organization'
      });
    }

    const { data: session, error: sessionError } =
      await supabaseAdmin.auth.signInWithPassword({
        email: body.email,
        password: body.password
      });

    if (sessionError || !session.session) {
      return reply.status(500).send({
        error: 'SessionFailed',
        message: 'User created but failed to generate session'
      });
    }

    return {
      user: { id: authData.user.id, email: authData.user.email },
      organization: { id: org.id, name: org.name, slug: org.slug, tier: org.tier },
      session: {
        access_token: session.session.access_token,
        refresh_token: session.session.refresh_token,
        expires_at: session.session.expires_at
      }
    };
  });

  // Login
  fastify.post('/auth/login', async (request, reply) => {
    const body = LoginSchema.parse(request.body);

    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email: body.email,
      password: body.password
    });

    if (error || !data.session) {
      return reply.status(401).send({
        error: 'LoginFailed',
        message: 'Invalid email or password'
      });
    }

    const { data: orgs } = await supabaseAdmin
      .from('org_members')
      .select('org_id, role, organizations(id, name, slug, tier)')
      .eq('user_id', data.user.id);

    return {
      user: { id: data.user.id, email: data.user.email },
      organizations: (orgs || []).map((om: any) => ({
        id: om.organizations.id,
        name: om.organizations.name,
        slug: om.organizations.slug,
        tier: om.organizations.tier,
        role: om.role
      })),
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      }
    };
  });

  // Refresh token
  fastify.post('/auth/refresh', async (request, reply) => {
    const { refresh_token } = request.body as { refresh_token: string };

    if (!refresh_token) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: 'Missing refresh_token'
      });
    }

    const { data, error } = await supabaseAdmin.auth.refreshSession({
      refresh_token
    });

    if (error || !data.session) {
      return reply.status(401).send({
        error: 'RefreshFailed',
        message: 'Invalid or expired refresh token'
      });
    }

    return {
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      }
    };
  });

  // Logout
  fastify.post('/auth/logout', async (request, reply) => {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (token) {
      await supabaseAdmin.auth.admin.signOut(token);
    }
    return { success: true };
  });
}
