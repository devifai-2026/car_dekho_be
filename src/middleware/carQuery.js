// Translates the /cars query params (body, fuel, maxLakh, limit) into a Mongo
// query, so the route handler stays declarative. Sets req.carQuery + req.carLimit.
export function buildCarQuery(req, _res, next) {
  const { body, fuel, maxLakh, limit = 50 } = req.query;
  const q = {};
  if (body) q.bodyType = body;
  if (fuel) q.fuelType = fuel;
  if (maxLakh) q.priceMaxINR = { $lte: Number(maxLakh) * 100000 };

  req.carQuery = q;
  req.carLimit = Math.min(Number(limit) || 50, 200);
  next();
}
