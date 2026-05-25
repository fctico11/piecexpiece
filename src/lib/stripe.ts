import Stripe from 'stripe';

export interface WorkshopClass {
  id: string;
  title: string;
  description: string;
  price: string;
  imageSrc: string;
  dateStr: string;
  duration: string;
  location: string;
  badge?: string;
  paymentLink?: string;
}

export async function getActiveClasses(): Promise<WorkshopClass[]> {
  try {
    const apiKey = import.meta.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
    
    // If no key is set (e.g. locally before the user adds it), return empty array gracefully
    if (!apiKey) {
      console.warn('⚠️ STRIPE_SECRET_KEY is not set. Returning empty classes list.');
      return [];
    }

    // Initialize Stripe. We use the key from the environment.
    const stripe = new Stripe(apiKey, {
      apiVersion: '2025-02-24.acacia', // Use the latest API version or your account's version
    });

    // Fetch active products, expanding their default prices
    const products = await stripe.products.list({
      active: true,
      expand: ['data.default_price'],
    });

    return products.data.map((product) => {
      // Determine the price string (e.g. "$65")
      let priceStr = 'TBD';
      if (product.default_price) {
        const priceObj = product.default_price as Stripe.Price;
        if (priceObj.unit_amount) {
          priceStr = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: priceObj.currency,
            maximumFractionDigits: 0,
          }).format(priceObj.unit_amount / 100);
        }
      }

      // Extract our custom metadata, falling back to defaults if missing
      const meta = product.metadata || {};
      
      return {
        id: product.id,
        title: product.name,
        description: product.description || '',
        price: priceStr,
        // Use the first image uploaded to the Stripe product, or a fallback
        imageSrc: product.images?.[0] || '/images/gallery-2.jpg',
        dateStr: meta.date || 'Date TBD',
        duration: meta.duration || '',
        location: meta.location || 'Studio 42, Brooklyn NY',
        badge: meta.badge || undefined,
        paymentLink: meta.payment_link || undefined,
      };
    });
  } catch (error) {
    console.error('Error fetching classes from Stripe:', error);
    return [];
  }
}
