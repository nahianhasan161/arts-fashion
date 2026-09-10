export interface ProductColor {
  name: string;
  hex: string;
}

export interface ProductSize {
  size: string;
  chest: string;
  stock: number;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  category: string;
  sub_category?: string;
  description: string;
  price: number;
  original_price: number;
  discount_percent: number;
  images: string[];
  colors: ProductColor[];
  sizes: ProductSize[];
  stock: number;
  rating: number;
  reviews_count: number;
  badge?: string;
  badge_type?: "discount" | "new" | "festive" | "popular";
  is_featured?: boolean;
  specs?: Record<string, string>;
}

export interface CartItem {
  id: string; // unique item id based on productId-size-color
  productId: string;
  slug: string;
  title: string;
  price: number;
  original_price: number;
  image: string;
  size: string;
  color: string;
  quantity: number;
  maxStock: number;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  count: number;
  group?: "topwear" | "bottomwear" | "special";
}

export interface OrderCustomerInfo {
  name: string;
  phone: string;
  email?: string;
  address: string;
  city: "dhaka" | "outside";
  notes?: string;
}

export interface Order {
  id: string;
  customer_name: string;
  customer_email?: string;
  customer_phone: string;
  delivery_address: string;
  city: string;
  subtotal: number;
  shipping_fee: number;
  total_amount: number;
  payment_method: "cod" | "bkash" | "nagad";
  status: "pending" | "processing" | "shipped" | "delivered";
  items: CartItem[];
  created_at: string;
}
