import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email,
          name: session.user.user_metadata?.name || session.user.email,
          emailConfirmed: !!session.user.email_confirmed_at || !!session.user.confirmed_at
        });
      }
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email,
          name: session.user.user_metadata?.name || session.user.email,
          emailConfirmed: !!session.user.email_confirmed_at || !!session.user.confirmed_at
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // Check if error is related to email confirmation
        if (error.message && (error.message.includes('email') || error.message.includes('confirm'))) {
          throw new Error('Please confirm your email address before signing in.');
        }
        throw error;
      }

      if (data?.user) {
        const emailConfirmed = !!data.user.email_confirmed_at || !!data.user.confirmed_at;
        const userData = {
          id: data.user.id,
          email: data.user.email,
          name: data.user.user_metadata?.name || data.user.email,
          emailConfirmed: emailConfirmed
        };
        
        // Only set user if email is confirmed
        if (emailConfirmed) {
          setUser(userData);
        }
        
        return userData;
      }

      throw new Error('Login failed');
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    }
  };

  const signUp = async (email, password, name) => {
    try {
      // Get the base URL for redirect (use window.location for client-side)
      const redirectTo = typeof window !== 'undefined' 
        ? `${window.location.origin}/login`
        : '/login';
      
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name: name || email,
          },
          emailRedirectTo: redirectTo,
        },
      });

      if (error) {
        throw error;
      }

      if (data?.user) {
        // Don't set user as logged in since email needs to be confirmed
        // User will need to sign in after confirming email
        return {
          id: data.user.id,
          email: data.user.email,
          name: data.user.user_metadata?.name || name || email,
          emailConfirmed: false
        };
      }

      throw new Error('Registration failed');
    } catch (error) {
      console.error('Sign up error:', error);
      throw error;
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  };

  const resetPassword = async (email) => {
    try {
      // Get the base URL for redirect (use window.location for client-side)
      const redirectTo = typeof window !== 'undefined' 
        ? `${window.location.origin}/reset-password`
        : '/reset-password';
      
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectTo,
      });

      if (error) {
        throw error;
      }

      return true;
    } catch (error) {
      console.error('Reset password error:', error);
      throw error;
    }
  };

  const updatePassword = async (newPassword) => {
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        throw error;
      }

      return true;
    } catch (error) {
      console.error('Update password error:', error);
      throw error;
    }
  };

  const value = {
    user,
    loading,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

