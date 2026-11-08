// Package middleware contains HTTP middleware shared across handlers.
package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"

	"github.com/talvoapp/universal-publishing/marketplace-service/internal/config"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/utils"
)

// AuthRole matches the roles issued by auth-service.
type AuthRole string

const (
	RoleReader AuthRole = "reader"
	RoleAuthor AuthRole = "author"
	RoleEditor AuthRole = "editor"
	RoleAdmin  AuthRole = "admin"
)

// AccessClaims is the payload inside a JWT access token.
type AccessClaims struct {
	Sub           string   `json:"sub"`
	Email         string   `json:"email"`
	Role          AuthRole `json:"role"`
	EmailVerified bool     `json:"emailVerified"`
	Type          string   `json:"type"`
	JTI           string   `json:"jti"`
	jwt.RegisteredClaims
}

// UserContext is the authenticated principal stored in request context.
type UserContext struct {
	ID            string
	Email         string
	Role          AuthRole
	EmailVerified bool
}

type userKey struct{}

// UserFromContext returns the authenticated user, or nil if absent.
func UserFromContext(ctx context.Context) *UserContext {
	if u, ok := ctx.Value(userKey{}).(*UserContext); ok {
		return u
	}
	return nil
}

// RequireAuth returns middleware that verifies the Bearer JWT and injects
// the user into the request context. Returns 401 if invalid/missing.
func RequireAuth(cfg *config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tokenStr := extractBearer(r)
			if tokenStr == "" {
				writeAuthError(w, r, "Missing Authorization header", "MISSING_AUTH")
				return
			}

			claims := &AccessClaims{}
			token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
				// Enforce HS256 — reject "none" and asymmetric confusion
				if t.Method.Alg() != "HS256" {
					return nil, jwt.ErrSignatureInvalid
				}
				return []byte(cfg.JWTSecret), nil
			},
				jwt.WithIssuer(cfg.JWTIssuer),
				jwt.WithAudience(cfg.JWTAudience),
				jwt.WithValidMethods([]string{"HS256"}),
			)

			if err != nil || !token.Valid {
				writeAuthError(w, r, "Invalid or expired token", "INVALID_TOKEN")
				return
			}

			if claims.Type != "access" {
				writeAuthError(w, r, "Token type mismatch", "INVALID_TOKEN_TYPE")
				return
			}

			user := &UserContext{
				ID:            claims.Sub,
				Email:         claims.Email,
				Role:          claims.Role,
				EmailVerified: claims.EmailVerified,
			}
			ctx := context.WithValue(r.Context(), userKey{}, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireVerifiedEmail returns middleware that 403s if email is not verified.
func RequireVerifiedEmail(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := UserFromContext(r.Context())
		if u == nil {
			writeAuthError(w, r, "Not authenticated", "UNAUTHORIZED")
			return
		}
		if !u.EmailVerified {
			writeAuthError(w, r, "Email verification required", "EMAIL_UNVERIFIED")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireRole returns middleware that 403s if the user lacks any of the
// listed roles. Admin implicitly satisfies any role.
func RequireRole(roles ...AuthRole) func(http.Handler) http.Handler {
	allowed := make(map[AuthRole]struct{}, len(roles))
	for _, r := range roles {
		allowed[r] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u := UserFromContext(r.Context())
			if u == nil {
				writeAuthError(w, r, "Not authenticated", "UNAUTHORIZED")
				return
			}
			if u.Role == RoleAdmin {
				next.ServeHTTP(w, r)
				return
			}
			if _, ok := allowed[u.Role]; !ok {
				writeAuthError(w, r, "Insufficient permissions", "FORBIDDEN")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// extractBearer parses "Bearer <token>" from the Authorization header.
func extractBearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if h == "" {
		return ""
	}
	parts := strings.SplitN(h, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	if len(parts[1]) > 4096 {
		return ""
	}
	return parts[1]
}

func writeAuthError(w http.ResponseWriter, r *http.Request, detail, code string) {
	appErr := utils.Unauthorized(detail, code)
	reqID, _ := r.Context().Value(RequestIDKey{}).(string)
	appErr.Write(w, reqID)
}