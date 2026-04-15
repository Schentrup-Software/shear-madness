import PocketBase from 'pocketbase';

const pb = new PocketBase(
  import.meta.env.VITE_POCKETBASE_URL ?? 'https://shear-madness.schentrupsoftware.com'
);

export default pb;
