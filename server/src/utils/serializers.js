// Shared response serializers so the JSON shape is defined in one place. Never includes
// passwordHash. `role` is a convenience alias for the first role.
export function serializeUser(u) {
  return {
    id: String(u._id ?? u.id),
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    roles: u.roles,
    role: u.roles?.[0] ?? null,
    active: u.active,
  };
}
