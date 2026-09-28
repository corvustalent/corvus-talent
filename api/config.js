export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json({
    url: process.env.SUPABASE_URL,
    anon: process.env.SUPABASE_ANON_KEY,
  });
}
