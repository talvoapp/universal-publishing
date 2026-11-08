package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/config"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/utils"
)

// AuthRole matches the roles issued by auth-service.
type AuthRole string

const (
	RoleReader AuthRole = "reader"
	RoleAuthor AuthRole = "author"
	RoleEditor AuthRole = "editor"
	RoleAdmin  AuthRole = "admin"
)

// AccessClaims is the JWT payload.
type AccessClaims struct {
	Sub           string   `json:"sub"`
	Email         string   `json:"email"`
	Role          AuthRole `json:"role"`
	EmailVerified bool     `json:"emailVerified"`
	Type          string   `json:"type"`
	JTI           string   `json:"jti"`
	jwt.RegisteredClaims
}

// UserContext is the authenticated principal.
type UserContext struct {
	ID            string
	Email         string
	Role          AuthRole
	EmailVerified bool
}

// UserContextKey is the exported context key for tests.
type UserContextKey struct{}

// UserFromContext returns the authenticated user, or nil.
func UserFromContext(ctx context.Context) *UserContext {
	if u, ok := ctx.Value(UserContextKey{}).(*UserContext); ok {
		return u
	}
	return nil
}

// RequireAuth verifies the Bearer JWT and injects the user.
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
			ctx := context.WithValue(r.Context(), UserContextKey{}, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireRole returns middleware that 403s if the user lacks any of the
// listed roles. Admin bypasses.
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
	reqID := RequestIDFromContext(r.Context())
	appErr.Write(w, reqID)
}